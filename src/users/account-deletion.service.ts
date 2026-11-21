import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

// Account removal — one place, used by both "close my account" (the user
// themselves) and Admin → Users → Delete.
//
// Why it is built this way: the platform keeps money/order history, so a
// user with orders, bookings, reviews, chats or wallet activity can't be
// hard-deleted (foreign keys would block it, and the vendor/buyer on the
// other side of those records still needs them). Before this, admins got a
// raw foreign-key error, and a user who was "deleted" still blocked their
// phone number from signing up again.
//
//  • No history  → HARD delete: the user, their empty shops (+ products),
//                  rider profile, empty wallet, memberships. Phone is free.
//  • History     → CLOSE: personal data removed, phone renamed to a
//                  unique tombstone ("deleted:<id>") so the real number is
//                  free to register again; shops hidden (REJECTED); the
//                  account can no longer log in. History stays intact.
export type DeleteResult = { mode: 'deleted' | 'closed'; phoneReleased: true; shopsAffected: number };

@Injectable()
export class AccountDeletionService {
  constructor(private prisma: PrismaService) {}

  /** What will happen if this user is removed — shown before confirming. */
  async preview(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, phone: true, role: true, deletedAt: true },
    });
    if (!user || user.deletedAt) throw new NotFoundException('Account not found');
    const h = await this.history(userId);
    return { user, hasHistory: h.total > 0, history: h };
  }

  async deleteAccount(userId: string, actor: { userId: string; role: string }): Promise<DeleteResult> {
    if (actor.role !== 'ADMIN' && actor.userId !== userId) {
      throw new ForbiddenException('You can only close your own account');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new NotFoundException('Account not found');
    if (user.role === 'ADMIN') {
      const admins = await this.prisma.user.count({ where: { role: 'ADMIN', deletedAt: null } });
      if (admins <= 1) throw new BadRequestException('This is the only admin account — it cannot be deleted.');
    }

    const h = await this.history(userId);
    const shops = await this.prisma.organization.findMany({ where: { ownerUserId: userId }, select: { id: true } });

    if (h.total === 0) {
      try {
        await this.prisma.$transaction(async (tx) => {
          for (const s of shops) await this.hardDeleteShop(tx, s.id);
          await tx.riderProfile.deleteMany({ where: { userId } });
          await tx.groupMember.deleteMany({ where: { userId } });
          await tx.replyVote.deleteMany({ where: { userId } });
          await tx.wallet.deleteMany({ where: { userId } }); // empty: no topups/transactions (checked in history)
          await tx.user.delete({ where: { id: userId } });
        });
        return { mode: 'deleted', phoneReleased: true, shopsAffected: shops.length };
      } catch (e) {
        // Some relation we didn't count still points at the user — fall
        // back to closing instead of showing a database error.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError)) throw e;
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.organization.updateMany({
        where: { ownerUserId: userId },
        data: { approvalStatus: 'REJECTED', approvalNote: 'Owner account closed' },
      });
      await tx.riderProfile.updateMany({ where: { userId }, data: { approvalStatus: 'REJECTED' } });
      await tx.passwordResetCode.deleteMany({ where: { userId } });
      await tx.user.update({
        where: { id: userId },
        data: {
          deletedAt: new Date(),
          phone: `deleted:${userId}`, // frees the real number; unique per user
          fullName: 'Deleted user',
          area: null,
          ward: null,
          passwordHash: '!', // never matches bcrypt → can't log in
        },
      });
    });
    return { mode: 'closed', phoneReleased: true, shopsAffected: shops.length };
  }

  /** Delete one shop (owner or admin). Empty shop → removed; otherwise hidden. */
  async deleteShop(orgId: string, actor: { userId: string; role: string }) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true, ownerUserId: true } });
    if (!org) throw new NotFoundException('Shop not found');
    if (actor.role !== 'ADMIN' && org.ownerUserId !== actor.userId) throw new ForbiddenException('Not your shop');
    const n = await this.shopHistory(orgId);
    if (n > 0) {
      await this.prisma.organization.update({
        where: { id: orgId },
        data: { approvalStatus: 'REJECTED', approvalNote: actor.role === 'ADMIN' ? 'Removed by admin' : 'Closed by owner' },
      });
      return { mode: 'hidden' as const, name: org.name };
    }
    await this.prisma.$transaction((tx) => this.hardDeleteShop(tx, orgId));
    return { mode: 'deleted' as const, name: org.name };
  }

  // ── internals ──────────────────────────────────────────────────────

  private async shopHistory(orgId: string) {
    const [orders, requests, slots, reviews] = await Promise.all([
      this.prisma.order.count({ where: { organizationId: orgId } }),
      this.prisma.serviceRequest.count({ where: { organizationId: orgId } }),
      this.prisma.bookingSlot.count({ where: { organizationId: orgId } }),
      this.prisma.shopReview.count({ where: { organizationId: orgId } }),
    ]);
    return orders + requests + slots + reviews;
  }

  private async hardDeleteShop(tx: Prisma.TransactionClient, orgId: string) {
    const products = await tx.product.findMany({ where: { organizationId: orgId }, select: { id: true } });
    const ids = products.map((p) => p.id);
    if (ids.length) {
      await tx.orderItem.deleteMany({ where: { productId: { in: ids } } });
      await tx.product.deleteMany({ where: { id: { in: ids } } });
    }
    await tx.conversation.deleteMany({ where: { organizationId: orgId } });
    await tx.shopQuestion.deleteMany({ where: { organizationId: orgId } });
    await tx.organization.delete({ where: { id: orgId } });
  }

  /** Everything that must be kept if it exists (blocks a hard delete). */
  private async history(userId: string) {
    const p = this.prisma;
    const shops = await p.organization.findMany({ where: { ownerUserId: userId }, select: { id: true } });
    const shopHistory = (await Promise.all(shops.map((s) => this.shopHistory(s.id)))).reduce((a, b) => a + b, 0);
    const wallet = await p.wallet.findUnique({ where: { userId }, select: { id: true, balance: true } });
    const [orders, deliveries, conversations, messages, questions, replies, groups, topics, posts, dmA, dmB, dms,
      serviceRequests, reviews, bookings, walletTx, walletTopups, adminActions] = await Promise.all([
      p.order.count({ where: { OR: [{ buyerId: userId }, { recipientId: userId }] } }),
      p.order.count({ where: { riderId: userId } }),
      p.conversation.count({ where: { buyerId: userId } }),
      p.message.count({ where: { senderId: userId } }),
      p.shopQuestion.count({ where: { askerId: userId } }),
      p.shopQuestionReply.count({ where: { authorId: userId } }),
      p.group.count({ where: { creatorId: userId } }),
      p.groupTopic.count({ where: { creatorId: userId } }),
      p.groupPost.count({ where: { authorId: userId } }),
      p.directConversation.count({ where: { userAId: userId } }),
      p.directConversation.count({ where: { userBId: userId } }),
      p.directMessage.count({ where: { senderId: userId } }),
      p.serviceRequest.count({ where: { buyerId: userId } }),
      p.shopReview.count({ where: { buyerId: userId } }),
      p.slotBooking.count({ where: { studentId: userId } }),
      wallet ? p.walletTransaction.count({ where: { walletId: wallet.id } }) : 0,
      wallet ? p.walletTopup.count({ where: { walletId: wallet.id } }) : 0,
      Promise.all([
        p.organization.count({ where: { verifiedById: userId } }),
        p.order.count({ where: { OR: [{ prescriptionReviewedById: userId }, { escrowReleasedById: userId }] } }),
        p.fraudFlag.count({ where: { resolvedById: userId } }),
        p.walletTopup.count({ where: { reviewedById: userId } }),
        p.serviceRequest.count({ where: { escrowReleasedById: userId } }),
        p.slotBooking.count({ where: { escrowReleasedById: userId } }),
      ]).then((a) => a.reduce((x, y) => x + y, 0)),
    ]);
    const walletBalance = wallet ? Number(wallet.balance) : 0;
    const parts = {
      orders, deliveries, shopOrdersAndBookings: shopHistory, serviceRequests, bookings, reviews,
      chats: conversations + messages + dmA + dmB + dms, community: questions + replies + groups + topics + posts,
      walletActivity: walletTx + walletTopups + (walletBalance !== 0 ? 1 : 0), adminActions,
    };
    return { ...parts, walletBalance, total: Object.values(parts).reduce((a, b) => a + b, 0) };
  }
}
