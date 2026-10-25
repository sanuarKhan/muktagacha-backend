import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  ApplyAsRiderDto,
  MarkDeliveredDto,
  RateDeliveryDto,
} from './dto/riders.dto.js';

@Injectable()
export class RidersService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // Self-apply: a user who registered with role=RIDER creates their rider
  // profile (vehicle, coverage area) - same two-step pattern as vendors
  // (register as VENDOR, then create an Organization). Starts PENDING
  // until admin approves, so random sign-ups can't immediately start
  // picking up real deliveries.
  async apply(userId: string, dto: ApplyAsRiderDto) {
    const existing = await this.prisma.riderProfile.findUnique({ where: { userId } });
    if (existing) {
      throw new ConflictException('You already have a rider application');
    }
    return this.prisma.riderProfile.create({
      data: {
        userId,
        vehicleType: dto.vehicleType,
        coverageArea: dto.coverageArea,
      },
    });
  }

  async myProfile(userId: string) {
    return this.prisma.riderProfile.findUnique({ where: { userId } });
  }

  async pendingApplications() {
    return this.prisma.riderProfile.findMany({
      where: { approvalStatus: 'PENDING' },
      include: { user: { select: { fullName: true, phone: true, area: true, ward: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async approve(riderProfileId: string) {
    return this.prisma.riderProfile.update({
      where: { id: riderProfileId },
      data: { approvalStatus: 'APPROVED' },
    });
  }

  async reject(riderProfileId: string) {
    return this.prisma.riderProfile.update({
      where: { id: riderProfileId },
      data: { approvalStatus: 'REJECTED' },
    });
  }

  // Approved riders only, for assignment pickers (admin/vendor choosing
  // who to assign) - includes rating/completed-count so whoever assigns
  // can make an informed pick, same transparency the buyer-facing side
  // gets with vendor approval status.
  async listApprovedRiders() {
    return this.prisma.riderProfile.findMany({
      where: { approvalStatus: 'APPROVED' },
      include: { user: { select: { fullName: true, phone: true } } },
      orderBy: { avgRating: 'desc' },
    });
  }

  // Vendor (own orders only) or admin (any order) assigns a rider.
  // Moves the order to OUT_FOR_DELIVERY as soon as a rider is attached -
  // this is the one real-world signal that "someone is now physically
  // carrying this order," which is what that status is meant to mean.
  async assignRider(orderId: string, riderUserId: string, userId: string, role: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { organization: true, buyer: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (role !== 'ADMIN' && order.organization.ownerUserId !== userId) {
      throw new ForbiddenException("This isn't your order");
    }
    const riderProfile = await this.prisma.riderProfile.findUnique({
      where: { userId: riderUserId },
      include: { user: true },
    });
    if (!riderProfile || riderProfile.approvalStatus !== 'APPROVED') {
      throw new BadRequestException('That rider is not an approved rider');
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { riderId: riderUserId, status: 'OUT_FOR_DELIVERY' },
      include: { organization: true, buyer: true, items: true, rider: true },
    });

    if (riderProfile.user.phone) {
      await this.notifications.sendSms(
        riderProfile.user.phone,
        `New delivery assigned: order for ${order.buyer.fullName} from ${order.organization.name}. Check the app for the address.`,
      );
    }
    if (order.buyer.phone) {
      await this.notifications.sendSms(
        order.buyer.phone,
        `Your order from ${order.organization.name} is out for delivery.`,
      );
    }

    return updated;
  }

  async unassignRider(orderId: string, userId: string, role: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { organization: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (role !== 'ADMIN' && order.organization.ownerUserId !== userId) {
      throw new ForbiddenException("This isn't your order");
    }
    return this.prisma.order.update({
      where: { id: orderId },
      data: { riderId: null },
    });
  }

  // Rider's own view: every order currently assigned to them and not yet
  // delivered, oldest first so the earliest-promised deliveries surface
  // at the top - this is the rider's actual work queue.
  async myDeliveries(riderUserId: string) {
    return this.prisma.order.findMany({
      where: { riderId: riderUserId, status: 'OUT_FOR_DELIVERY' },
      orderBy: { createdAt: 'asc' },
      include: {
        buyer: { select: { fullName: true, phone: true, area: true, ward: true } },
        organization: { select: { name: true } },
        items: true,
      },
    });
  }

  async myDeliveryHistory(riderUserId: string) {
    return this.prisma.order.findMany({
      where: { riderId: riderUserId, status: 'COMPLETED' },
      orderBy: { deliveredAt: 'desc' },
      include: {
        buyer: { select: { fullName: true } },
        organization: { select: { name: true } },
      },
    });
  }

  // Rider marks their own delivery complete and bumps their public
  // completedDeliveries counter - this is the real "delivered" event,
  // distinct from a vendor/admin manually flipping order status.
  async markDelivered(orderId: string, riderUserId: string, dto: MarkDeliveredDto) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.riderId !== riderUserId) {
      throw new ForbiddenException('This delivery is not assigned to you');
    }
    const [updatedOrder] = await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: orderId },
        data: {
          status: 'COMPLETED',
          deliveredAt: new Date(),
          deliveryNote: dto.deliveryNote ?? order.deliveryNote,
        },
      }),
      this.prisma.riderProfile.update({
        where: { userId: riderUserId },
        data: { completedDeliveries: { increment: 1 } },
      }),
    ]);
    return updatedOrder;
  }

  // Buyer rates a completed delivery (one rating per order, enforced by
  // the @@unique on DeliveryRating.orderId). Recomputes the rider's
  // avgRating as a simple arithmetic mean over all their ratings -
  // cheap enough at pilot scale, no need for a running-average trick yet.
  async rateDelivery(orderId: string, buyerId: string, dto: RateDeliveryDto) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.buyerId !== buyerId) {
      throw new ForbiddenException('This is not your order');
    }
    if (!order.riderId || order.status !== 'COMPLETED') {
      throw new BadRequestException('This order has no completed delivery to rate');
    }
    const riderProfile = await this.prisma.riderProfile.findUnique({
      where: { userId: order.riderId },
    });
    if (!riderProfile) throw new NotFoundException('Rider profile not found');

    await this.prisma.deliveryRating.create({
      data: {
        riderId: riderProfile.id,
        orderId,
        rating: dto.rating,
        comment: dto.comment,
      },
    });

    const agg = await this.prisma.deliveryRating.aggregate({
      where: { riderId: riderProfile.id },
      _avg: { rating: true },
    });
    await this.prisma.riderProfile.update({
      where: { id: riderProfile.id },
      data: { avgRating: agg._avg.rating ?? undefined },
    });

    return { ok: true };
  }
}
