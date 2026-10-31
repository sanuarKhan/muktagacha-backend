import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  CreateServiceRequestDto,
  QuoteServiceRequestDto,
  UpdateServiceRequestStatusDto,
  SubmitServicePaymentProofDto,
} from './dto/service-request.dto.js';

const SAFE_BUYER_SELECT = {
  id: true,
  phone: true,
  fullName: true,
  role: true,
  area: true,
  ward: true,
} as const;

// Services vertical - request/quote flow, deliberately different from
// Marketplace/Pharmacy's cart-and-checkout. See the schema comment above
// ServiceRequest for the full rationale (no fixed price upfront, matches
// the Sheba.xyz reference model named in the original plan).
@Injectable()
export class ServiceRequestsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async create(buyerId: string, dto: CreateServiceRequestDto) {
    const org = await this.prisma.organization.findUnique({ where: { id: dto.organizationId } });
    if (!org) throw new NotFoundException('Provider not found');
    if (org.vertical !== 'SERVICES') {
      throw new BadRequestException('This shop does not offer bookable services');
    }
    if (org.ownerUserId === buyerId) {
      throw new BadRequestException("You can't book your own service");
    }

    const request = await this.prisma.serviceRequest.create({
      data: {
        buyerId,
        organizationId: dto.organizationId,
        categoryId: dto.categoryId,
        description: dto.description,
        photoUrl: dto.photoUrl,
        addressText: dto.addressText,
        latitude: dto.latitude,
        longitude: dto.longitude,
        preferredTime: dto.preferredTime,
      },
      include: {
        buyer: { select: SAFE_BUYER_SELECT },
        organization: true,
        category: true,
      },
    });

    // Reuses the existing SMS pipeline - a provider sees a new request the
    // same way a vendor sees a new order, no separate notification system.
    const owner = await this.prisma.user.findUnique({ where: { id: org.ownerUserId } });
    if (owner) {
      await this.notifications
        .sendSms(
          owner.phone,
          `New service request on Muktagacha: "${dto.description.slice(0, 100)}" - open your dashboard to send a quote.`,
        )
        .catch(() => {});
    }

    return request;
  }

  findMine(buyerId: string) {
    return this.prisma.serviceRequest.findMany({
      where: { buyerId },
      include: { organization: true, category: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  findByOrganization(organizationId: string) {
    return this.prisma.serviceRequest.findMany({
      where: { organizationId },
      include: { buyer: { select: SAFE_BUYER_SELECT }, category: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string, role: string) {
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id },
      include: {
        buyer: { select: SAFE_BUYER_SELECT },
        organization: true,
        category: true,
      },
    });
    if (!request) throw new NotFoundException('Service request not found');
    const isBuyer = request.buyerId === userId;
    const isProviderOwner = request.organization.ownerUserId === userId;
    if (role !== 'ADMIN' && !isBuyer && !isProviderOwner) {
      throw new ForbiddenException("This isn't your service request");
    }
    return request;
  }

  // Provider sends a price quote after reviewing the described problem.
  // Only valid from REQUESTED - a request that's already been quoted,
  // accepted, or resolved shouldn't get a second surprise quote.
  async sendQuote(id: string, userId: string, role: string, dto: QuoteServiceRequestDto) {
    const request = await this.assertProviderOwner(id, userId, role);
    if (request.status !== 'REQUESTED') {
      throw new BadRequestException('A quote can only be sent on a newly requested booking');
    }
    const updated = await this.prisma.serviceRequest.update({
      where: { id },
      data: {
        status: 'QUOTED',
        quotedPrice: dto.quotedPrice,
        quoteNote: dto.quoteNote,
        quotedAt: new Date(),
      },
      include: { buyer: { select: SAFE_BUYER_SELECT }, organization: true },
    });
    await this.notifications
      .sendSms(
        updated.buyer!.phone,
        `${updated.organization.name} quoted ৳${dto.quotedPrice} for your service request. Open the app to accept or decline.`,
      )
      .catch(() => {});
    return updated;
  }

  // Buyer accepts/declines the quote, or either side cancels/progresses
  // the job afterward. Each transition is restricted to who's allowed to
  // make it and from what prior state, mirroring the Order status-guard
  // pattern already used elsewhere.
  async updateStatus(id: string, userId: string, role: string, dto: UpdateServiceRequestStatusDto) {
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id },
      include: { organization: true, buyer: { select: SAFE_BUYER_SELECT } },
    });
    if (!request) throw new NotFoundException('Service request not found');
    const isBuyer = request.buyerId === userId;
    const isProviderOwner = request.organization.ownerUserId === userId;
    if (role !== 'ADMIN' && !isBuyer && !isProviderOwner) {
      throw new ForbiddenException("This isn't your service request");
    }

    const next = dto.status;
    const allowedTransitions: Record<string, string[]> = {
      // Buyer accepts/declines a quote they received.
      ACCEPTED: ['QUOTED'],
      // Buyer can cancel any time before work actually starts.
      CANCELLED: ['REQUESTED', 'QUOTED', 'ACCEPTED'],
      // Provider declines (e.g. too busy, out of their coverage area).
      DECLINED: ['REQUESTED', 'QUOTED'],
      // Provider marks they've started the job.
      IN_PROGRESS: ['ACCEPTED'],
      // Either side can confirm the work is done.
      COMPLETED: ['IN_PROGRESS', 'ACCEPTED'],
    };
    if (!allowedTransitions[next]?.includes(request.status)) {
      throw new BadRequestException(
        `Can't move a ${request.status} request directly to ${next}`,
      );
    }

    // Only the buyer can accept/decline-their-side or cancel; only the
    // provider can decline/progress their side of the job.
    if (next === 'ACCEPTED' && !isBuyer && role !== 'ADMIN') {
      throw new ForbiddenException('Only the buyer can accept a quote');
    }
    if ((next === 'IN_PROGRESS' || next === 'DECLINED') && !isProviderOwner && role !== 'ADMIN') {
      throw new ForbiddenException('Only the provider can do that');
    }

    const updated = await this.prisma.serviceRequest.update({
      where: { id },
      data: {
        status: next,
        completedAt: next === 'COMPLETED' ? new Date() : undefined,
      },
      include: { buyer: { select: SAFE_BUYER_SELECT }, organization: true },
    });
    return updated;
  }

  // Same manual-payment-proof pattern as regular orders - buyer pays the
  // provider's bKash/Nagad number (or cash) AFTER the work is done, since
  // the price wasn't known upfront.
  async submitPayment(id: string, buyerId: string, dto: SubmitServicePaymentProofDto) {
    const request = await this.prisma.serviceRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Service request not found');
    if (request.buyerId !== buyerId) throw new ForbiddenException('Not your service request');
    if (request.status !== 'COMPLETED') {
      throw new BadRequestException('Payment can only be submitted once the job is completed');
    }
    return this.prisma.serviceRequest.update({
      where: { id },
      data: {
        paymentMethod: dto.paymentMethod,
        paymentTrxId: dto.trxId,
        paymentVerification:
          dto.paymentMethod === 'CASH_ON_DELIVERY' ? 'NOT_SUBMITTED' : 'PENDING_VERIFICATION',
      },
    });
  }

  async verifyPayment(id: string, userId: string, role: string, verification: 'VERIFIED' | 'REJECTED') {
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id },
      include: { organization: true },
    });
    if (!request) throw new NotFoundException('Service request not found');
    if (role !== 'ADMIN' && request.organization.ownerUserId !== userId) {
      throw new ForbiddenException('Not your organization');
    }
    return this.prisma.serviceRequest.update({
      where: { id },
      data: { paymentVerification: verification, paymentVerifiedAt: new Date() },
    });
  }

  private async assertProviderOwner(id: string, userId: string, role: string) {
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id },
      include: { organization: true },
    });
    if (!request) throw new NotFoundException('Service request not found');
    if (role !== 'ADMIN' && request.organization.ownerUserId !== userId) {
      throw new ForbiddenException('Not your organization');
    }
    return request;
  }
}
