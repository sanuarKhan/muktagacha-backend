import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SkodePayService } from '../skodepay/skodepay.service.js';
import { FraudDetectionService } from '../fraud/fraud-detection.service.js';
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
    private skodePay: SkodePayService,
    private fraudDetection: FraudDetectionService,
  ) {}

  // Price comes from the server's own Product/ProductVariant record, NEVER
  // from the client - an earlier version trusted a client-submitted price,
  // which let any buyer set their own price for anything. Stock is
  // validated and decremented inside a single transaction so two buyers
  // racing for the last unit can't both succeed (the update's WHERE
  // clause only matches if enough stock remains at the moment of write).
  async create(buyerId: string, dto: CreateOrderDto) {
    // Gift validation happens outside the transaction (read-only check,
    // no need to hold a DB transaction open for it).
    if (dto.isGift) {
      if (!dto.recipientId) {
        throw new BadRequestException('Choose who this gift is for');
      }
      if (dto.recipientId === buyerId) {
        throw new BadRequestException("You can't send a gift to yourself");
      }
      const recipient = await this.prisma.user.findUnique({ where: { id: dto.recipientId } });
      if (!recipient) throw new NotFoundException('Recipient not found');
    }

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
          deliveryLatitude: dto.deliveryLatitude,
          deliveryLongitude: dto.deliveryLongitude,
          deliveryAddressText: dto.deliveryAddressText,
          isGift: !!dto.isGift,
          recipientId: dto.isGift ? dto.recipientId : undefined,
          giftMessage: dto.isGift ? dto.giftMessage : undefined,
          giftSenderAnonymous: dto.isGift ? !!dto.giftSenderAnonymous : false,
          // Manual-MFS orders need a TrxID before the vendor will confirm
          // them; cash orders have nothing to verify.
          paymentVerification:
            dto.paymentMethod === 'CASH_ON_DELIVERY'
              ? 'NOT_SUBMITTED'
              : 'PENDING_VERIFICATION',
          items: { create: itemsWithPrice },
        },
        include: {
          items: true,
          buyer: { select: SAFE_BUYER_SELECT },
          recipient: { select: SAFE_BUYER_SELECT },
          organization: true,
        },
      });
    });

    await this.notifications.notifyOrderCreated(order);
    if (order.isGift && order.recipientId) {
      // Recipient gets their own notification - a different message than
      // the buyer's order-confirmation one, since from the recipient's side
      // this isn't "your order was placed", it's "someone sent you a gift".
      await this.notifications.notifyGiftReceived(order).catch(() => {
        // Non-fatal: notification failure should never roll back a
        // successfully placed and paid-for order.
      });
    }

    // Fraud detection runs AFTER the order is fully created and never
    // blocks or delays the buyer - a flag just adds to the admin review
    // queue, the order itself proceeds exactly as normal either way.
    const totalAmount = order.items.reduce((sum, it) => sum + Number(it.price) * it.quantity, 0);
    await this.fraudDetection.evaluateNewOrder(order.id, buyerId, dto.organizationId, totalAmount);

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
      include: {
        items: { include: { product: true, variant: true } },
        organization: true,
        recipient: { select: SAFE_BUYER_SELECT },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Gifts this user has RECEIVED from someone else - separate from
  // findMine (which is what they bought/sent). Shown on its own "Gifts for
  // you" section rather than mixed into the normal order list, since from
  // the recipient's side these aren't purchases they made.
  findGiftsReceived(recipientId: string) {
    return this.prisma.order.findMany({
      where: { recipientId, isGift: true },
      include: {
        items: { include: { product: true, variant: true } },
        organization: true,
        // Only expose the sender's identity if they chose NOT to stay
        // anonymous - otherwise this field is omitted entirely rather
        // than relying on the frontend to remember to hide it.
        buyer: { select: SAFE_BUYER_SELECT },
      },
      orderBy: { createdAt: 'desc' },
    }).then((orders) =>
      orders.map((o) => ({
        ...o,
        buyer: o.giftSenderAnonymous ? null : o.buyer,
      })),
    );
  }

  findByOrganization(organizationId: string) {
    return this.prisma.order.findMany({
      where: { organizationId },
      include: {
        items: { include: { product: true, variant: true } },
        buyer: { select: SAFE_BUYER_SELECT },
        recipient: { select: SAFE_BUYER_SELECT },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Single order detail, with everything an invoice/receipt needs. The
  // buyer who placed it, the vendor who owns it, the GIFT RECIPIENT (if
  // this is a gift order), or an admin can view it - an order is private,
  // not a public resource.
  async findOne(orderId: string, userId: string, role: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: true, variant: true } },
        buyer: { select: SAFE_BUYER_SELECT },
        recipient: { select: SAFE_BUYER_SELECT },
        organization: true,
        rider: { select: { fullName: true, phone: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    const isBuyer = order.buyerId === userId;
    const isRecipient = order.recipientId === userId;
    const isVendorOwner = order.organization.ownerUserId === userId;
    if (role !== 'ADMIN' && !isBuyer && !isRecipient && !isVendorOwner) {
      throw new ForbiddenException("This isn't your order");
    }
    // Recipient viewing an anonymous gift never sees the sender's identity,
    // even though they're an authorized viewer of the order itself.
    if (isRecipient && !isBuyer && order.giftSenderAnonymous) {
      return { ...order, buyer: null };
    }
    return order;
  }

  // Creates a real SkodePay hosted-checkout transaction for an existing
  // order (buyer picked SKODEPAY as the payment method). Only the
  // buyer who placed the order can start this - it costs the vendor's
  // SkodePay account a transaction attempt, so no one else should be
  // able to trigger it.
  async createSkodePayCheckout(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.buyerId !== userId) {
      throw new ForbiddenException("This isn't your order");
    }
    if (order.paymentMethod !== 'SKODEPAY') {
      throw new BadRequestException('This order was not placed with SkodePay');
    }
    if (order.skodePayCheckoutUrl) {
      // Already started - return the existing link instead of creating
      // a second transaction for the same order.
      return { ref: order.skodePayRef, checkoutUrl: order.skodePayCheckoutUrl };
    }

    const buyer = await this.prisma.user.findUnique({ where: { id: userId } });
    const total = order.items.reduce(
      (sum, it) => sum + Number(it.price) * it.quantity,
      0,
    );

    const checkout = await this.skodePay.createCheckout(
      order.organizationId,
      total,
      buyer?.fullName || 'Buyer',
      buyer?.phone || '',
      order.id,
    );

    await this.prisma.order.update({
      where: { id: orderId },
      data: { skodePayRef: checkout.ref, skodePayCheckoutUrl: checkout.checkoutUrl },
    });

    return checkout;
  }

  // Buyer returns from SkodePay's hosted checkout page - checks the
  // real transaction status and, if SkodePay confirms it completed,
  // moves the order to CONFIRMED (same effect as a manually-verified
  // bKash/Nagad payment, just with SkodePay having done the real
  // verification instead of the vendor eyeballing their SMS).
  async checkSkodePayStatus(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.buyerId !== userId) {
      throw new ForbiddenException("This isn't your order");
    }
    if (!order.skodePayRef) {
      throw new BadRequestException('No SkodePay checkout was started for this order');
    }

    const status = await this.skodePay.checkStatus(order.organizationId, order.skodePayRef);

    if (status === 'completed' && order.status === 'PENDING') {
      const updated = await this.prisma.order.update({
        where: { id: orderId },
        data: { status: 'CONFIRMED', paymentVerification: 'VERIFIED', paymentVerifiedAt: new Date() },
        include: {
          buyer: { select: SAFE_BUYER_SELECT },
          organization: true,
          items: { include: { product: true, variant: true } },
        },
      });
      await this.notifications.notifyOrderStatusChanged(updated);
      return { status: 'completed', order: updated };
    }

    return { status };
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
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        paymentTrxId: dto.trxId,
        paymentVerification: 'PENDING_VERIFICATION',
      },
    });
    // Catches the single clearest fraud signal available for manual
    // bKash/Nagad payments: the exact same transaction ID submitted as
    // "proof" on more than one order.
    await this.fraudDetection.evaluatePaymentProof(orderId, dto.trxId);
    return updated;
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
