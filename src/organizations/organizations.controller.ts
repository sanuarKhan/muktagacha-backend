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
