import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RidersService } from './riders.service.js';
import {
  ApplyAsRiderDto,
  AssignRiderDto,
  MarkDeliveredDto,
  RateDeliveryDto,
} from './dto/riders.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';

@Controller('riders')
@UseGuards(JwtAuthGuard)
export class RidersController {
  constructor(private ridersService: RidersService) {}

  // Self-apply - any logged-in user (expected: registered with role=RIDER)
  // can submit a rider application. Starts PENDING until admin approves.
  @Post('apply')
  apply(@Req() req: any, @Body() dto: ApplyAsRiderDto) {
    return this.ridersService.apply(req.user.userId, dto);
  }

  @Get('me')
  myProfile(@Req() req: any) {
    return this.ridersService.myProfile(req.user.userId);
  }

  @Get('me/deliveries')
  myDeliveries(@Req() req: any) {
    return this.ridersService.myDeliveries(req.user.userId);
  }

  @Get('me/history')
  myHistory(@Req() req: any) {
    return this.ridersService.myDeliveryHistory(req.user.userId);
  }

  @Patch('deliveries/:orderId/complete')
  markDelivered(
    @Param('orderId') orderId: string,
    @Req() req: any,
    @Body() dto: MarkDeliveredDto,
  ) {
    return this.ridersService.markDelivered(orderId, req.user.userId, dto);
  }

  // Admin-only: review and decide on rider applications.
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Get('pending')
  pending() {
    return this.ridersService.pendingApplications();
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Patch(':riderProfileId/approve')
  approve(@Param('riderProfileId') id: string) {
    return this.ridersService.approve(id);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Patch(':riderProfileId/reject')
  reject(@Param('riderProfileId') id: string) {
    return this.ridersService.reject(id);
  }

  // Approved-rider directory, visible to admin and vendors picking who
  // to assign a delivery to.
  @Get('approved')
  listApproved() {
    return this.ridersService.listApprovedRiders();
  }

  // Order-level assignment lives on /riders so the riders module owns
  // all delivery-assignment logic in one place, even though it mutates
  // Order rows (same cross-module pattern as Marketing touching Order
  // indirectly via campaigns - nothing new here).
  @Post('orders/:orderId/assign')
  assignRider(
    @Param('orderId') orderId: string,
    @Req() req: any,
    @Body() dto: AssignRiderDto,
  ) {
    return this.ridersService.assignRider(
      orderId,
      dto.riderId,
      req.user.userId,
      req.user.role,
    );
  }

  @Patch('orders/:orderId/unassign')
  unassignRider(@Param('orderId') orderId: string, @Req() req: any) {
    return this.ridersService.unassignRider(orderId, req.user.userId, req.user.role);
  }

  // Buyer rates a completed delivery.
  @Post('orders/:orderId/rate')
  rateDelivery(
    @Param('orderId') orderId: string,
    @Req() req: any,
    @Body() dto: RateDeliveryDto,
  ) {
    return this.ridersService.rateDelivery(orderId, req.user.userId, dto);
  }
}
