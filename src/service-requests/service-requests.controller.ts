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
import { ServiceRequestsService } from './service-requests.service.js';
import {
  CreateServiceRequestDto,
  QuoteServiceRequestDto,
  UpdateServiceRequestStatusDto,
  SubmitServicePaymentProofDto,
} from './dto/service-request.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

@Controller('service-requests')
@UseGuards(JwtAuthGuard)
export class ServiceRequestsController {
  constructor(private service: ServiceRequestsService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateServiceRequestDto) {
    return this.service.create(req.user.userId, dto);
  }

  @Get('mine')
  findMine(@Req() req: any) {
    return this.service.findMine(req.user.userId);
  }

  @Get('organization/:organizationId')
  findByOrganization(@Param('organizationId') organizationId: string) {
    return this.service.findByOrganization(organizationId);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.service.findOne(id, req.user.userId, req.user.role);
  }

  // Provider sends a price quote after reviewing the request.
  @Patch(':id/quote')
  sendQuote(@Req() req: any, @Param('id') id: string, @Body() dto: QuoteServiceRequestDto) {
    return this.service.sendQuote(id, req.user.userId, req.user.role, dto);
  }

  @Patch(':id/status')
  updateStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateServiceRequestStatusDto,
  ) {
    return this.service.updateStatus(id, req.user.userId, req.user.role, dto);
  }

  @Post(':id/payment')
  submitPayment(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: SubmitServicePaymentProofDto,
  ) {
    return this.service.submitPayment(id, req.user.userId, dto);
  }

  @Patch(':id/verify-payment')
  verifyPayment(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { verification: 'VERIFIED' | 'REJECTED' },
  ) {
    return this.service.verifyPayment(id, req.user.userId, req.user.role, body.verification);
  }
}
