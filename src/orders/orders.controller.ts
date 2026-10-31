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
import { OrdersService } from './orders.service.js';
import {
  CreateOrderDto,
  UpdateOrderStatusDto,
  SubmitPaymentProofDto,
  VerifyPaymentDto,
} from './dto/order.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(req.user.userId, dto);
  }

  @Get('mine')
  findMine(@Req() req: any) {
    return this.ordersService.findMine(req.user.userId);
  }

  // Gifts sent TO this user by someone else - declared before ':id' so
  // NestJS doesn't treat "gifts-received" as an order id.
  @Get('gifts-received')
  findGiftsReceived(@Req() req: any) {
    return this.ordersService.findGiftsReceived(req.user.userId);
  }

  @Get('organization/:organizationId')
  findByOrganization(@Param('organizationId') organizationId: string) {
    return this.ordersService.findByOrganization(organizationId);
  }

  // Single order detail (for the invoice/receipt page). Declared after
  // the more specific GET routes above so NestJS doesn't treat "mine"
  // or "organization" as an :id value.
  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.ordersService.findOne(id, req.user.userId, req.user.role);
  }

  @Patch(':id/status')
  updateStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(
      id,
      req.user.userId,
      req.user.role,
      dto,
    );
  }

  // Buyer submits a TrxID after paying the vendor's bKash/Nagad number
  // directly - see v3 plan Section 6, Path A (no real payment gateway,
  // honest manual verification instead).
  @Post(':id/payment-proof')
  submitPaymentProof(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: SubmitPaymentProofDto,
  ) {
    return this.ordersService.submitPaymentProof(id, req.user.userId, dto);
  }

  // Vendor (or admin) confirms/rejects the buyer's submitted TrxID.
  @Patch(':id/verify-payment')
  verifyPayment(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: VerifyPaymentDto,
  ) {
    return this.ordersService.verifyPayment(
      id,
      req.user.userId,
      req.user.role,
      dto,
    );
  }

  // Creates a real SkodePay hosted-checkout transaction for this order
  // (buyer chose SKODEPAY as the payment method). Returns the checkout
  // URL to redirect the buyer to.
  @Post(':id/skodepay-checkout')
  createSkodePayCheckout(@Req() req: any, @Param('id') id: string) {
    return this.ordersService.createSkodePayCheckout(id, req.user.userId);
  }

  // Buyer returns from SkodePay's hosted page - checks whether the
  // payment actually completed and moves the order to CONFIRMED if so.
  @Post(':id/skodepay-status')
  checkSkodePayStatus(@Req() req: any, @Param('id') id: string) {
    return this.ordersService.checkSkodePayStatus(id, req.user.userId);
  }

  // Pharmacy: buyer uploads a photo of their prescription (already
  // hosted via the existing Cloudinary signing flow - this just records
  // the resulting URL against the order).
  @Post(':id/prescription')
  submitPrescription(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { imageUrl: string },
  ) {
    return this.ordersService.submitPrescription(id, req.user.userId, body.imageUrl);
  }

  // Pharmacy: vendor (or admin) approves or rejects the uploaded
  // prescription photo.
  @Patch(':id/prescription-review')
  reviewPrescription(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { decision: 'APPROVED' | 'REJECTED'; note?: string },
  ) {
    return this.ordersService.reviewPrescription(
      id,
      req.user.userId,
      req.user.role,
      body.decision,
      body.note,
    );
  }

  // Escrow: buyer confirms they genuinely received a completed order.
  // Required before an admin can release escrowed funds to the vendor
  // (unless the admin force-overrides for an unresponsive buyer).
  @Post(':id/confirm-delivery')
  confirmDelivery(@Req() req: any, @Param('id') id: string) {
    return this.ordersService.confirmDelivery(id, req.user.userId);
  }

  // Escrow: releases wallet funds held for this order to the vendor.
  // ADMIN-ONLY, enforced server-side by RolesGuard (not just hidden in
  // the UI) - a buyer or vendor hitting this endpoint directly gets a
  // 403, regardless of what the frontend shows them. This is the real
  // security boundary for escrow: no client-side control decides who can
  // move money, only this guard does.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch(':id/release-escrow')
  releaseEscrow(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { force?: boolean },
  ) {
    return this.ordersService.releaseEscrow(id, req.user.userId, !!body?.force);
  }
}
