import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';

@Controller('organizations')
export class OrganizationsController {
  constructor(private orgsService: OrganizationsService) {}

  // Public: browse approved vendors/pharmacies/services, filterable by
  // area/ward/vertical (ward-level scoping per the platform plan)
  @Get()
  findApproved(
    @Query('area') area?: string,
    @Query('ward') ward?: string,
    @Query('vertical') vertical?: string,
  ) {
    return this.orgsService.findApproved({ area, ward, vertical });
  }

  // Vendor self-signup — any authenticated user can request to open a
  // storefront; it stays PENDING until an admin approves it.
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Req() req: any, @Body() dto: CreateOrganizationDto) {
    return this.orgsService.create(req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('mine')
  findMine(@Req() req: any) {
    return this.orgsService.findMine(req.user.userId);
  }

  // Vendor updates their own bKash/Nagad numbers shown to buyers at
  // checkout (manual-payment verification flow, v3 plan Section 6).
  @UseGuards(JwtAuthGuard)
  @Patch(':id/payment-numbers')
  updatePaymentNumbers(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { bkashNumber?: string; nagadNumber?: string },
  ) {
    return this.orgsService.updatePaymentNumbers(
      id,
      req.user.userId,
      req.user.role,
      body,
    );
  }

  // Vendor connects their own SkodePay merchant account for real hosted
  // checkout (bKash/Nagad/card via SkodePay, as an alternative to the
  // manual pay-direct-and-submit-TrxID flow).
  @UseGuards(JwtAuthGuard)
  @Patch(':id/skodepay-settings')
  updateSkodePaySettings(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { apiKey?: string; enabled?: boolean },
  ) {
    return this.orgsService.updateSkodePaySettings(
      id,
      req.user.userId,
      req.user.role,
      body,
    );
  }

  // Vendor pins their shop's real location on the free OpenStreetMap
  // picker (Settings -> Location) - shown to buyers on the storefront
  // page so they can see exactly where the shop is.
  @UseGuards(JwtAuthGuard)
  @Patch(':id/location')
  updateLocation(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { latitude: number; longitude: number },
  ) {
    return this.orgsService.updateLocation(
      id,
      req.user.userId,
      req.user.role,
      body,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('pending')
  findPending() {
    return this.orgsService.findPending();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch(':id/approve')
  approve(@Param('id') id: string) {
    return this.orgsService.approve(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch(':id/reject')
  reject(@Param('id') id: string) {
    return this.orgsService.reject(id);
  }
}
