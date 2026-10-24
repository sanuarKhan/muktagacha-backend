import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  CreateOrderDto,
  UpdateOrderStatusDto,
  SubmitPaymentProofDto,
  VerifyPaymentDto,
} from './dto/order.dto.js';

const SAFE_BUYER_SELECT = {
  id: true,
  phone: true,
  fullName: true,
  role: true,
  area: true,
  ward: true,
} as const;

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async create(buyerId: string, dto: CreateOrderDto) {
    const order = await this.prisma.order.create({
      data: {
        buyerId,
        organizationId: dto.organizationId,
        paymentMethod: dto.paymentMethod,
        status: 'PENDING',
        // Manual-MFS orders need a TrxID before the vendor will confirm
        // them; cash orders have nothing to verify.
        paymentVerification:
          dto.paymentMethod === 'CASH_ON_DELIVERY' ? 'NOT_SUBMITTED' : 'PENDING_VERIFICATION',
        items: {
          create: dto.items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            price: item.price,
          })),
        },
      },
      include: { items: true, buyer: { select: SAFE_BUYER_SELECT }, organization: true },
    });

    await this.notifications.notifyOrderCreated(order);
    return order;
  }

  findMine(buyerId: string) {
    return this.prisma.order.findMany({
      where: { buyerId },
      include: { items: { include: { product: true, variant: true } }, organization: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  findByOrganization(organizationId: string) {
    return this.prisma.order.findMany({
      where: { organizationId },
      include: {
        items: { include: { product: true, variant: true } },
        buyer: { select: SAFE_BUYER_SELECT },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(
    orderId: string,
    userId: string,
    role: string,
    dto: UpdateOrderStatusDto,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { organization: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (role !== 'ADMIN' && order.organization.ownerUserId !== userId) {
      throw new ForbiddenException('Not your organization order');
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: dto.status },
      include: { buyer: { select: SAFE_BUYER_SELECT }, organization: true },
    });

    await this.notifications.notifyOrderStatusChanged(updated);
    return updated;
  }

  // Buyer submits proof of payment (TrxID) after paying the vendor's
  // bKash/Nagad number directly - see v3 plan Section 6, Path A.
  async submitPaymentProof(orderId: string, buyerId: string, dto: SubmitPaymentProofDto) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.buyerId !== buyerId) {
      throw new ForbiddenException('Not your order');
    }
    if (order.paymentMethod === 'CASH_ON_DELIVERY') {
      throw new BadRequestException('Cash on delivery orders do not need payment proof');
    }
    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        paymentTrxId: dto.trxId,
        paymentVerification: 'PENDING_VERIFICATION',
      },
    });
  }

  // Vendor (or admin) checks the TrxID against their own bKash/Nagad
  // statement and confirms or rejects it - same manual-verification
  // pattern SkodePay itself uses, just without SkodePay's SMS automation.
  async verifyPayment(
    orderId: string,
    userId: string,
    role: string,
    dto: VerifyPaymentDto,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { organization: true, buyer: { select: SAFE_BUYER_SELECT } },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (role !== 'ADMIN' && order.organization.ownerUserId !== userId) {
      throw new ForbiddenException('Not your organization order');
    }
    if (!order.paymentTrxId) {
      throw new BadRequestException('Buyer has not submitted a payment TrxID yet');
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        paymentVerification: dto.verification,
        paymentVerifiedAt: new Date(),
        // Verifying payment is a natural trigger to move the order
        // forward; rejecting it keeps the order PENDING so the buyer
        // can resubmit a corrected TrxID.
        status: dto.verification === 'VERIFIED' ? 'CONFIRMED' : order.status,
      },
      include: { buyer: { select: SAFE_BUYER_SELECT }, organization: true },
    });

    await this.notifications.notifyOrderStatusChanged(updated);
    return updated;
  }
}
