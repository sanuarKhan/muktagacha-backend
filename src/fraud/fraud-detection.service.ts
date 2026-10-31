import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

// Rule-based fraud/abuse detection for orders. Deliberately NOT a blind
// auto-block: every rule that fires just writes a FraudFlag row and the
// order proceeds completely normally. An admin reviews the queue
// (GET /admin/fraud-flags) and decides what to actually do - this matches
// the client's explicit instruction ("just flag it for admin review,
// order still proceeds normally"). A human always makes the final call,
// which matters a lot for a trust-based community platform where a false
// positive (wrongly blocking a real neighbor's order) does real harm.
//
// Rules implemented (all genuinely detectable from data we already have -
// no invented signal):
// 1. RAPID REPEAT ORDERS - same buyer placing several orders with the
//    same vendor in a very short window (could be a bot, could be a
//    buyer testing stolen payment details, could just be someone adding
//    items in separate carts - flagged as LOW for a human to glance at).
// 2. HIGH COD CANCELLATION / NO-SHOW RATE - a buyer whose past
//    Cash-on-Delivery orders are frequently CANCELLED is the single most
//    common real fraud pattern in COD marketplaces (orders placed with no
//    intent to actually accept delivery, wasting a vendor's prep time and
//    a rider's trip).
// 3. REUSED PAYMENT TrxID - the same bKash/Nagad transaction ID submitted
//    as "proof of payment" on more than one order is close to definitive
//    evidence of fraud (a real transaction ID can only pay for one thing).
// 4. BRAND NEW ACCOUNT + HIGH VALUE ORDER - an account created minutes
//    ago placing an unusually large order is a common scam pattern
//    (stolen payment info, or a buyer with no community reputation yet
//    placing a large COD order they may not accept).
@Injectable()
export class FraudDetectionService {
  private readonly logger = new Logger(FraudDetectionService.name);

  constructor(private prisma: PrismaService) {}

  async flag(orderId: string, reason: string, severity: 'LOW' | 'MEDIUM' | 'HIGH') {
    await this.prisma.fraudFlag.create({ data: { orderId, reason, severity } });
    this.logger.warn(`Fraud flag [${severity}] on order ${orderId}: ${reason}`);
  }

  // Run every rule against a just-created order. Never throws - a bug in
  // fraud detection must never block a real order from being placed.
  async evaluateNewOrder(orderId: string, buyerId: string, organizationId: string, totalAmount: number) {
    try {
      await Promise.all([
        this.checkRapidRepeatOrders(orderId, buyerId, organizationId),
        this.checkCodCancellationRate(orderId, buyerId),
        this.checkNewAccountHighValue(orderId, buyerId, totalAmount),
      ]);
    } catch (err) {
      this.logger.error(`Fraud evaluation failed for order ${orderId}: ${(err as Error).message}`);
    }
  }

  // Run when a buyer submits a payment TrxID (bKash/Nagad) - checked
  // separately from order-creation time since the TrxID isn't known yet
  // at that point.
  async evaluatePaymentProof(orderId: string, trxId: string) {
    try {
      await this.checkReusedTrxId(orderId, trxId);
    } catch (err) {
      this.logger.error(`Fraud evaluation (payment proof) failed for order ${orderId}: ${(err as Error).message}`);
    }
  }

  private async checkRapidRepeatOrders(orderId: string, buyerId: string, organizationId: string) {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const recentCount = await this.prisma.order.count({
      where: {
        buyerId,
        organizationId,
        createdAt: { gte: fifteenMinutesAgo },
        id: { not: orderId },
      },
    });
    if (recentCount >= 3) {
      await this.flag(
        orderId,
        `Buyer placed ${recentCount + 1} orders with this same vendor in the last 15 minutes`,
        'MEDIUM',
      );
    }
  }

  private async checkCodCancellationRate(orderId: string, buyerId: string) {
    const pastOrders = await this.prisma.order.findMany({
      where: {
        buyerId,
        paymentMethod: 'CASH_ON_DELIVERY',
        id: { not: orderId },
      },
      select: { status: true },
    });
    // Need a meaningful sample before flagging - one cancelled order out
    // of one is noise, five out of six is a real pattern.
    if (pastOrders.length < 3) return;
    const cancelledCount = pastOrders.filter((o) => o.status === 'CANCELLED').length;
    const rate = cancelledCount / pastOrders.length;
    if (rate >= 0.5) {
      await this.flag(
        orderId,
        `Buyer has cancelled ${cancelledCount} of their last ${pastOrders.length} Cash-on-Delivery orders`,
        'HIGH',
      );
    }
  }

  private async checkNewAccountHighValue(orderId: string, buyerId: string, totalAmount: number) {
    const buyer = await this.prisma.user.findUnique({ where: { id: buyerId } });
    if (!buyer) return;
    const accountAgeMs = Date.now() - buyer.createdAt.getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;
    // ৳3,000 is a deliberately simple, explainable threshold - not tuned
    // against real data yet (there isn't any), easy for the admin to
    // understand and adjust later once real order-value patterns exist.
    if (accountAgeMs < oneDayMs && totalAmount >= 3000) {
      await this.flag(
        orderId,
        `Account created less than a day ago placed a ৳${totalAmount} order`,
        'LOW',
      );
    }
  }

  private async checkReusedTrxId(orderId: string, trxId: string) {
    const reused = await this.prisma.order.findFirst({
      where: { paymentTrxId: trxId, id: { not: orderId } },
    });
    if (reused) {
      await this.flag(
        orderId,
        `Transaction ID "${trxId}" was already submitted on a different order (${reused.id})`,
        'HIGH',
      );
    }
  }
}
