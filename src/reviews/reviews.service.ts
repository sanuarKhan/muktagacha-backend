import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateShopReviewDto } from './dto/review.dto.js';

// One review per completed transaction (Order OR ServiceRequest), left
// by the buyer who actually completed it - same proven pattern as
// RiderProfile/DeliveryRating (riders.service.ts rateDelivery), applied
// to shops instead of individual riders. Can't review a transaction that
// isn't actually complete, and can't review the same one twice.
@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  // Review a completed Order (Marketplace/Pharmacy purchase).
  async reviewOrder(orderId: string, buyerId: string, dto: CreateShopReviewDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { shopReview: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.buyerId !== buyerId) {
      throw new ForbiddenException('This is not your order');
    }
    if (order.status !== 'COMPLETED') {
      throw new BadRequestException('You can only review a completed order');
    }
    if (order.shopReview) {
      throw new BadRequestException('You already reviewed this order');
    }

    await this.prisma.shopReview.create({
      data: {
        organizationId: order.organizationId,
        buyerId,
        orderId,
        rating: dto.rating,
        comment: dto.comment,
      },
    });
    await this.recomputeAverage(order.organizationId);
    return { ok: true };
  }

  // Review a completed ServiceRequest (a finished service job).
  async reviewServiceRequest(requestId: string, buyerId: string, dto: CreateShopReviewDto) {
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id: requestId },
      include: { shopReview: true },
    });
    if (!request) throw new NotFoundException('Service request not found');
    if (request.buyerId !== buyerId) {
      throw new ForbiddenException('This is not your booking');
    }
    if (request.status !== 'COMPLETED') {
      throw new BadRequestException('You can only review a completed booking');
    }
    if (request.shopReview) {
      throw new BadRequestException('You already reviewed this booking');
    }

    await this.prisma.shopReview.create({
      data: {
        organizationId: request.organizationId,
        buyerId,
        serviceRequestId: requestId,
        rating: dto.rating,
        comment: dto.comment,
      },
    });
    await this.recomputeAverage(request.organizationId);
    return { ok: true };
  }

  // Review a completed SlotBooking (Education/consultation session).
  async reviewSlotBooking(bookingId: string, buyerId: string, dto: CreateShopReviewDto) {
    const booking = await this.prisma.slotBooking.findUnique({
      where: { id: bookingId },
      include: { slot: true, shopReview: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.studentId !== buyerId) {
      throw new ForbiddenException('This is not your booking');
    }
    if (booking.slot.status !== 'COMPLETED') {
      throw new BadRequestException('You can only review a completed booking');
    }
    if (booking.shopReview) {
      throw new BadRequestException('You already reviewed this booking');
    }

    await this.prisma.shopReview.create({
      data: {
        organizationId: booking.slot.organizationId,
        buyerId,
        slotBookingId: bookingId,
        rating: dto.rating,
        comment: dto.comment,
      },
    });
    await this.recomputeAverage(booking.slot.organizationId);
    return { ok: true };
  }

  // Public: every review for a shop, newest first, for display on the
  // storefront/shop-info modal.
  findByOrganization(organizationId: string) {
    return this.prisma.shopReview.findMany({
      where: { organizationId },
      include: { buyer: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async recomputeAverage(organizationId: string) {
    const agg = await this.prisma.shopReview.aggregate({
      where: { organizationId },
      _avg: { rating: true },
      _count: { rating: true },
    });
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        avgRating: agg._avg.rating ?? undefined,
        reviewCount: agg._count.rating,
      },
    });
  }
}
