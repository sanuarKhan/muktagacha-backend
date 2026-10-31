import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { WalletsService } from '../wallets/wallets.service.js';
import {
  CreateBookingSlotDto,
  BookSlotDto,
  SubmitSlotPaymentProofDto,
} from './dto/booking.dto.js';

const SAFE_STUDENT_SELECT = {
  id: true,
  phone: true,
  fullName: true,
  role: true,
} as const;

// Education/consultation vertical - calendar-based slot booking, the
// third distinct booking shape in this schema (see the schema comment
// above BookingSlot for the full rationale vs. Order/ServiceRequest).
@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private wallets: WalletsService,
  ) {}

  // Provider publishes a bookable slot. Only the organization's own
  // owner (or admin) can publish slots for it - the same ownership check
  // pattern used everywhere else in this codebase.
  async createSlot(userId: string, role: string, dto: CreateBookingSlotDto) {
    const org = await this.prisma.organization.findUnique({ where: { id: dto.organizationId } });
    if (!org) throw new NotFoundException('Organization not found');
    if (role !== 'ADMIN' && org.ownerUserId !== userId) {
      throw new ForbiddenException('Not your organization');
    }
    if (org.vertical !== 'EDUCATION') {
      throw new BadRequestException('This shop does not offer calendar-based bookings');
    }
    const start = new Date(dto.startAt);
    const end = new Date(dto.endAt);
    if (end <= start) {
      throw new BadRequestException('End time must be after start time');
    }
    if (start < new Date()) {
      throw new BadRequestException('Cannot publish a slot in the past');
    }
    return this.prisma.bookingSlot.create({
      data: {
        organizationId: dto.organizationId,
        categoryId: dto.categoryId,
        title: dto.title,
        description: dto.description,
        startAt: start,
        endAt: end,
        price: dto.price,
        isOnline: dto.isOnline ?? true,
        location: dto.location,
      },
    });
  }

  // Public: every OPEN, still-upcoming slot for a given provider, for
  // students to browse and book.
  findAvailableSlots(organizationId: string) {
    return this.prisma.bookingSlot.findMany({
      where: { organizationId, status: 'OPEN', startAt: { gte: new Date() } },
      orderBy: { startAt: 'asc' },
    });
  }

  findSlotsByOrganization(organizationId: string) {
    return this.prisma.bookingSlot.findMany({
      where: { organizationId },
      include: { booking: { include: { student: { select: SAFE_STUDENT_SELECT } } } },
      orderBy: { startAt: 'asc' },
    });
  }

  // Provider cancels an unbooked slot (or a booked one, which also
  // cancels/refunds the booking on it - see cancelSlot below).
  async cancelSlot(slotId: string, userId: string, role: string) {
    const slot = await this.prisma.bookingSlot.findUnique({
      where: { id: slotId },
      include: { organization: true, booking: true },
    });
    if (!slot) throw new NotFoundException('Slot not found');
    if (role !== 'ADMIN' && slot.organization.ownerUserId !== userId) {
      throw new ForbiddenException('Not your organization');
    }
    if (slot.booking) {
      // A booked slot being cancelled refunds the student (if paid by
      // wallet) exactly like an order/booking cancellation - the
      // provider never actually delivered the session, so the money
      // shouldn't be kept.
      if (slot.booking.escrowStatus === 'HELD') {
        await this.wallets.refund(slot.booking.studentId, Number(slot.price), {});
      }
      await this.prisma.slotBooking.update({
        where: { id: slot.booking.id },
        data: { cancelledAt: new Date(), escrowStatus: slot.booking.escrowStatus === 'HELD' ? 'REFUNDED' : undefined },
      });
    }
    return this.prisma.bookingSlot.update({
      where: { id: slotId },
      data: { status: 'CANCELLED' },
    });
  }

  // Student books an open slot. Security/race-safety: the actual booking
  // row is only created if the slot's WHERE clause still matches status
  // = OPEN at the moment of the update - two students racing for the
  // same slot can never both succeed, the DB's own row-level locking
  // settles it, not application logic that could race.
  async bookSlot(slotId: string, studentId: string, dto: BookSlotDto) {
    const slot = await this.prisma.bookingSlot.findUnique({
      where: { id: slotId },
      include: { organization: true },
    });
    if (!slot) throw new NotFoundException('Slot not found');
    if (slot.organization.ownerUserId === studentId) {
      throw new BadRequestException("You can't book your own slot");
    }
    if (slot.startAt < new Date()) {
      throw new BadRequestException('This slot has already passed');
    }

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.bookingSlot.updateMany({
        where: { id: slotId, status: 'OPEN' },
        data: { status: 'BOOKED' },
      });
      if (result.count === 0) {
        throw new BadRequestException('This slot was just booked by someone else');
      }
      const booking = await tx.slotBooking.create({
        data: { slotId, studentId, note: dto.note },
        include: { slot: true },
      });
      return booking;
    }).then(async (booking) => {
      // Notify the provider - same SMS pipeline as every other
      // new-order/new-request notification in this system.
      const owner = await this.prisma.user.findUnique({ where: { id: slot.organization.ownerUserId } });
      if (owner) {
        await this.notifications
          .sendSms(
            owner.phone,
            `New booking on Muktagacha: "${slot.title}" on ${slot.startAt.toLocaleString()} - open your dashboard for details.`,
          )
          .catch(() => {});
      }
      return booking;
    });
  }

  findMyBookings(studentId: string) {
    return this.prisma.slotBooking.findMany({
      where: { studentId },
      include: { slot: { include: { organization: true, category: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string, role: string) {
    const booking = await this.prisma.slotBooking.findUnique({
      where: { id },
      include: { slot: { include: { organization: true } }, student: { select: SAFE_STUDENT_SELECT } },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    const isStudent = booking.studentId === userId;
    const isProviderOwner = booking.slot.organization.ownerUserId === userId;
    if (role !== 'ADMIN' && !isStudent && !isProviderOwner) {
      throw new ForbiddenException("This isn't your booking");
    }
    return booking;
  }

  // Provider sets the meeting link once a slot is booked (for online
  // sessions) - a simple, low-friction way to hand off the actual video
  // call, no calendar/video API integration needed for Phase 1.5.
  async setMeetingLink(id: string, userId: string, role: string, meetingLink: string) {
    const booking = await this.prisma.slotBooking.findUnique({
      where: { id },
      include: { slot: { include: { organization: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (role !== 'ADMIN' && booking.slot.organization.ownerUserId !== userId) {
      throw new ForbiddenException('Not your organization');
    }
    return this.prisma.bookingSlot.update({
      where: { id: booking.slotId },
      data: { meetingLink },
    });
  }

  // Provider (or admin) marks the session completed - mirrors Order's
  // COMPLETED status, the trigger that lets the student rate/review and
  // (for wallet payments) confirm receipt for escrow release.
  async markCompleted(id: string, userId: string, role: string) {
    const booking = await this.prisma.slotBooking.findUnique({
      where: { id },
      include: { slot: { include: { organization: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (role !== 'ADMIN' && booking.slot.organization.ownerUserId !== userId) {
      throw new ForbiddenException('Not your organization');
    }
    await this.prisma.bookingSlot.update({
      where: { id: booking.slotId },
      data: { status: 'COMPLETED' },
    });
    return this.prisma.slotBooking.findUnique({ where: { id }, include: { slot: true } });
  }

  // Same manual-payment-proof pattern as Orders/ServiceRequests - student
  // pays the provider's bKash/Nagad number directly, or from wallet
  // (settled immediately, held in escrow exactly like the other two
  // booking types).
  async submitPayment(id: string, studentId: string, dto: SubmitSlotPaymentProofDto) {
    const booking = await this.prisma.slotBooking.findUnique({
      where: { id },
      include: { slot: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.studentId !== studentId) throw new ForbiddenException('Not your booking');
    if (booking.paymentMethod) {
      throw new BadRequestException('Payment was already submitted for this booking');
    }

    if (dto.paymentMethod === 'WALLET') {
      return this.prisma.$transaction(async (tx) => {
        const txnId = await this.wallets.spend(tx, studentId, Number(booking.slot.price), {});
        await tx.walletTransaction.update({ where: { id: txnId }, data: { note: `Slot booking ${id}` } });
        return tx.slotBooking.update({
          where: { id },
          data: {
            paymentMethod: 'WALLET',
            paymentVerification: 'VERIFIED',
            paymentVerifiedAt: new Date(),
            escrowStatus: 'HELD',
            escrowHeldAt: new Date(),
          },
        });
      });
    }

    return this.prisma.slotBooking.update({
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
    const booking = await this.prisma.slotBooking.findUnique({
      where: { id },
      include: { slot: { include: { organization: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (role !== 'ADMIN' && booking.slot.organization.ownerUserId !== userId) {
      throw new ForbiddenException('Not your organization');
    }
    return this.prisma.slotBooking.update({
      where: { id },
      data: { paymentVerification: verification, paymentVerifiedAt: new Date() },
    });
  }

  // Student-only: confirms they genuinely received the session. Required
  // before an admin can release escrowed funds - same security boundary
  // as Orders/ServiceRequests confirm-and-release.
  async confirmCompletion(id: string, studentId: string) {
    const booking = await this.prisma.slotBooking.findUnique({
      where: { id },
      include: { slot: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.studentId !== studentId) throw new ForbiddenException('Not your booking');
    if (booking.slot.status !== 'COMPLETED') {
      throw new BadRequestException('You can only confirm a booking that has been marked completed');
    }
    if (booking.escrowStatus !== 'HELD') {
      throw new BadRequestException('This booking has no escrow payment to confirm');
    }
    return this.prisma.slotBooking.update({
      where: { id },
      data: { buyerConfirmedAt: new Date() },
    });
  }

  // Admin-only escrow release - identical security boundary and
  // force-override semantics as Orders.releaseEscrow /
  // ServiceRequests.releaseEscrow.
  async releaseEscrow(id: string, adminId: string, force = false) {
    const booking = await this.prisma.slotBooking.findUnique({
      where: { id },
      include: { slot: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.escrowStatus !== 'HELD') {
      throw new BadRequestException(
        `This booking's escrow is ${booking.escrowStatus}, not HELD - nothing to release`,
      );
    }
    if (booking.slot.status !== 'COMPLETED') {
      throw new BadRequestException('Escrow can only be released once the session is marked COMPLETED');
    }
    if (!booking.buyerConfirmedAt && !force) {
      throw new BadRequestException(
        'The student has not confirmed the session yet - wait for their confirmation, or pass force=true to override as admin',
      );
    }
    return this.prisma.slotBooking.update({
      where: { id },
      data: {
        escrowStatus: 'RELEASED',
        escrowReleasedAt: new Date(),
        escrowReleasedById: adminId,
      },
    });
  }
}
