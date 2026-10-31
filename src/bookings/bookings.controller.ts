import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { BookingsService } from './bookings.service.js';
import {
  CreateBookingSlotDto,
  BookSlotDto,
  SubmitSlotPaymentProofDto,
} from './dto/booking.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';

@Controller()
export class BookingsController {
  constructor(private bookings: BookingsService) {}

  // Public: browse a provider's open slots - no auth needed to look.
  @Get('organizations/:organizationId/slots')
  findAvailableSlots(@Param('organizationId') organizationId: string) {
    return this.bookings.findAvailableSlots(organizationId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('slots')
  createSlot(@Req() req: any, @Body() dto: CreateBookingSlotDto) {
    return this.bookings.createSlot(req.user.userId, req.user.role, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('organizations/:organizationId/slots/all')
  findSlotsByOrganization(@Param('organizationId') organizationId: string) {
    return this.bookings.findSlotsByOrganization(organizationId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('slots/:id/cancel')
  cancelSlot(@Req() req: any, @Param('id') id: string) {
    return this.bookings.cancelSlot(id, req.user.userId, req.user.role);
  }

  @UseGuards(JwtAuthGuard)
  @Post('slots/:id/book')
  bookSlot(@Req() req: any, @Param('id') id: string, @Body() dto: BookSlotDto) {
    return this.bookings.bookSlot(id, req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('bookings/mine')
  findMyBookings(@Req() req: any) {
    return this.bookings.findMyBookings(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('bookings/:id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.bookings.findOne(id, req.user.userId, req.user.role);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('bookings/:id/meeting-link')
  setMeetingLink(@Req() req: any, @Param('id') id: string, @Body() body: { meetingLink: string }) {
    return this.bookings.setMeetingLink(id, req.user.userId, req.user.role, body.meetingLink);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('bookings/:id/complete')
  markCompleted(@Req() req: any, @Param('id') id: string) {
    return this.bookings.markCompleted(id, req.user.userId, req.user.role);
  }

  @UseGuards(JwtAuthGuard)
  @Post('bookings/:id/payment')
  submitPayment(@Req() req: any, @Param('id') id: string, @Body() dto: SubmitSlotPaymentProofDto) {
    return this.bookings.submitPayment(id, req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('bookings/:id/verify-payment')
  verifyPayment(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { verification: 'VERIFIED' | 'REJECTED' },
  ) {
    return this.bookings.verifyPayment(id, req.user.userId, req.user.role, body.verification);
  }

  @UseGuards(JwtAuthGuard)
  @Post('bookings/:id/confirm-completion')
  confirmCompletion(@Req() req: any, @Param('id') id: string) {
    return this.bookings.confirmCompletion(id, req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('bookings/:id/release-escrow')
  releaseEscrow(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { force?: boolean },
  ) {
    return this.bookings.releaseEscrow(id, req.user.userId, !!body?.force);
  }
}
