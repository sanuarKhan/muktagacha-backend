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
}
