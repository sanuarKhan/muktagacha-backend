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

  // Price comes from the server's own Product/ProductVariant record, NEVER
  // from the client - an earlier version trusted a client-submitted price,
  // which let any buyer set their own price for anything. Stock is
  // validated and decremented inside a single transaction so two buyers
  // racing for the last unit can't both succeed (the update's WHERE
  // clause only matches if enough stock remains at the moment of write).
  async create(buyerId: string, dto: CreateOrderDto) {
    const order = await this.prisma.$transaction(async (tx) => {
      const itemsWithPrice: {
        productId: string;
        variantId?: string;
        quantity: number;
        price: number;
      }[] = [];

      for (const item of dto.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          include: { variants: true },
        });
        if (!product || !product.isActive) {
          throw new BadRequestException(`Product ${item.productId} is not available`);
        }
        if (product.organizationId !== dto.organizationId) {
          throw new BadRequestException(
            'All items in one order must belong to the same shop',
          );
        }

        let price: number;
        if (product.hasVariants) {
          if (!item.variantId) {
            throw new BadRequestException(
              `${product.name} requires choosing a variant (size/color)`,
            );
          }
          const variant = product.variants.find((v) => v.id === item.variantId);
          if (!variant || !variant.isActive) {
            throw new BadRequestException('That variant is not available');
          }
          if (variant.stockCount < item.quantity) {
            throw new BadRequestException(
              `Only ${variant.stockCount} left in stock for ${product.name}`,
            );
          }
          price = variant.priceOverride
            ? Number(variant.priceOverride)
            : Number(product.basePrice);

          const result = await tx.productVariant.updateMany({
            where: { id: variant.id, stockCount: { gte: item.quantity } },
            data: { stockCount: { decrement: item.quantity } },
          });
          if (result.count === 0) {
            throw new BadRequestException(
              `${product.name} just sold out - someone else bought the last one`,
            );
          }
        } else {
          price = Number(product.basePrice);
        }

        itemsWithPrice.push({
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          price,
        });
      }

      return tx.order.create({
        data: {
          buyerId,
          organizationId: dto.organizationId,
          paymentMethod: dto.paymentMethod,
          status: 'PENDING',
          // Manual-MFS orders need a TrxID before the vendor will confirm
          // them; cash orders have nothing to verify.
          paymentVerification:
            dto.paymentMethod === 'CASH_ON_DELIVERY'
              ? 'NOT_SUBMITTED'
              : 'PENDING_VERIFICATION',
          items: { create: itemsWithPrice },
        },
        include: { items: true, buyer: { select: SAFE_BUYER_SELECT }, organization: true },
      });
    });

    await this.notifications.notifyOrderCreated(order);
    return order;
  }

  // Restores stock for a cancelled order - mirrors the decrement in
  // create() so cancelling a confirmed-but-not-yet-shipped order doesn't
  // permanently lose that stock to a sale that never actually happened.
  private async restoreStock(orderId: string) {
    const items = await this.prisma.orderItem.findMany({
      where: { orderId, variantId: { not: null } },
    });
    for (const item of items) {
      if (item.variantId) {
        await this.prisma.productVariant.update({
          where: { id: item.variantId },
          data: { stockCount: { increment: item.quantity } },
        });
      }
    }
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

  // Single order detail, with everything an invoice/receipt needs. Only
  // the buyer who placed it, the vendor who owns it, or an admin can
  // view it - an order is private, not a public resource.
  async findOne(orderId: string, userId: string, role: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: true, variant: true } },
        buyer: { select: SAFE_BUYER_SELECT },
        organization: true,
        rider: { select: { fullName: true, phone: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    const isBuyer = order.buyerId === userId;
    const isVendorOwner = order.organization.ownerUserId === userId;
    if (role !== 'ADMIN' && !isBuyer && !isVendorOwner) {
      throw new ForbiddenException("This isn't your order");
    }
    return order;
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
      include: {
        buyer: { select: SAFE_BUYER_SELECT },
        organization: true,
        items: { include: { product: true, variant: true } },
      },
    });

    // Cancelling an order that had stock reserved gives it back - a
    // cancelled sale shouldn't permanently reduce the shop's inventory.
    if (dto.status === 'CANCELLED' && order.status !== 'CANCELLED') {
      await this.restoreStock(orderId);
    }

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
      include: {
        buyer: { select: SAFE_BUYER_SELECT },
        organization: true,
        items: { include: { product: true, variant: true } },
      },
    });

    await this.notifications.notifyOrderStatusChanged(updated);
    return updated;
  }
}
