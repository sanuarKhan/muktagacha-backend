import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequestTopupDto } from './dto/wallet.dto.js';

// Closed-loop wallet: buy credit with real money, spend it anywhere on
// the platform. HARD LEGAL CONSTRAINT from the plan: no withdrawal, no
// person-to-person transfer, ever - this file deliberately has no method
// that moves money OUT of the platform or to another user's wallet. Every
// method either adds credit (verified topup) or spends it against a
// purchase (checkout). This is what keeps it simple store-credit (legal,
// no banking license) instead of an e-money product (needs Bangladesh
// Bank licensing) or anything resembling the cryptocurrency idea the
// founder explicitly and correctly ruled out as out of scope.
@Injectable()
export class WalletsService {
  constructor(private prisma: PrismaService) {}

  // Every user gets a wallet lazily on first access - no need to create
  // one at signup for users who never use the feature.
  async getOrCreateWallet(userId: string) {
    let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await this.prisma.wallet.create({ data: { userId } });
    }
    return wallet;
  }

  async getBalance(userId: string) {
    const wallet = await this.getOrCreateWallet(userId);
    return { balance: wallet.balance };
  }

  async getHistory(userId: string) {
    const wallet = await this.getOrCreateWallet(userId);
    return this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Buyer requests a topup after paying the PLATFORM's own bKash/Nagad
  // number directly (shown in the frontend from env-configured numbers,
  // same manual-proof pattern as every vendor payment) - credit is only
  // added once an admin verifies the TrxID actually landed.
  async requestTopup(userId: string, dto: RequestTopupDto) {
    const wallet = await this.getOrCreateWallet(userId);
    return this.prisma.walletTopup.create({
      data: {
        walletId: wallet.id,
        amount: dto.amount,
        method: dto.method,
        trxId: dto.trxId,
      },
    });
  }

  async myTopups(userId: string) {
    const wallet = await this.getOrCreateWallet(userId);
    return this.prisma.walletTopup.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Admin-only review queue.
  pendingTopups() {
    return this.prisma.walletTopup.findMany({
      where: { status: 'PENDING_VERIFICATION' },
      include: { wallet: { include: { user: { select: { fullName: true, phone: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Admin verifies or rejects a topup. Verifying is the ONLY place
  // credit is ever created - in one transaction with the ledger entry so
  // the denormalized balance and the immutable transaction log can never
  // drift apart.
  async reviewTopup(topupId: string, adminId: string, decision: 'VERIFIED' | 'REJECTED') {
    const topup = await this.prisma.walletTopup.findUnique({ where: { id: topupId } });
    if (!topup) throw new NotFoundException('Topup request not found');
    if (topup.status !== 'PENDING_VERIFICATION') {
      throw new BadRequestException('This topup was already reviewed');
    }

    if (decision === 'REJECTED') {
      return this.prisma.walletTopup.update({
        where: { id: topupId },
        data: { status: 'REJECTED', reviewedAt: new Date(), reviewedById: adminId },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.walletTopup.update({
        where: { id: topupId },
        data: { status: 'VERIFIED', reviewedAt: new Date(), reviewedById: adminId },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: topup.walletId,
          type: 'TOPUP',
          amount: topup.amount,
          note: `Wallet top-up via ${topup.method}${topup.trxId ? ` (TrxID ${topup.trxId})` : ''}`,
        },
      });
      await tx.wallet.update({
        where: { id: topup.walletId },
        data: { balance: { increment: topup.amount } },
      });
      return updated;
    });
  }

  // Spends wallet balance against a purchase. Called internally by
  // OrdersService/ServiceRequestsService when the buyer chose WALLET as
  // their payment method - never exposed as a public endpoint callable
  // with an arbitrary amount, to prevent a buyer draining their own
  // wallet for anything other than a real purchase. Returns the created
  // transaction id so the caller can backfill orderId/serviceRequestId
  // once that record exists (chicken-and-egg: the purchase doesn't have
  // an id yet at the moment payment is taken).
  async spend(
    tx: any,
    userId: string,
    amount: number,
    ref: { orderId?: string; serviceRequestId?: string },
  ): Promise<string> {
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet || Number(wallet.balance) < amount) {
      throw new BadRequestException('Insufficient wallet balance');
    }
    const txn = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'SPEND',
        amount: -amount,
        orderId: ref.orderId,
        serviceRequestId: ref.serviceRequestId,
      },
    });
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { decrement: amount } },
    });
    return txn.id;
  }

  // Refunds wallet balance when a wallet-paid order/booking is cancelled
  // after payment - credit goes back into the platform wallet (never
  // cash, never another user), consistent with the closed-loop rule.
  async refund(
    userId: string,
    amount: number,
    ref: { orderId?: string; serviceRequestId?: string },
  ) {
    const wallet = await this.getOrCreateWallet(userId);
    await this.prisma.$transaction([
      this.prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'REFUND',
          amount,
          orderId: ref.orderId,
          serviceRequestId: ref.serviceRequestId,
        },
      }),
      this.prisma.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: amount } },
      }),
    ]);
  }
}
