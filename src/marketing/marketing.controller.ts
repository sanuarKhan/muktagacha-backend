import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MarketingService } from './marketing.service.js';
import { VendorSmsService } from './vendor-sms.service.js';
import { AddContactsDto, CreateCampaignDto } from './dto/marketing.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

@Controller('organizations/:organizationId/marketing')
@UseGuards(JwtAuthGuard)
export class MarketingController {
  constructor(
    private marketingService: MarketingService,
    private vendorSms: VendorSmsService,
  ) {}

  // --- Vendor's own SMS phone ---------------------------------------------
  // The vendor connects their own Android phone so campaigns are sent from
  // their number and billed to their SIM.

  @Get('sms-phone')
  smsPhoneStatus(
    @Param('organizationId') organizationId: string,
    @Req() req: any,
  ) {
    return this.vendorSms.getStatus(organizationId, req.user.userId);
  }

  @Post('sms-phone')
  connectSmsPhone(
    @Param('organizationId') organizationId: string,
    @Req() req: any,
    @Body() body: { login: string; password: string; phone?: string },
  ) {
    return this.vendorSms.connect(
      organizationId,
      req.user.userId,
      body?.login,
      body?.password,
      body?.phone,
    );
  }

  @Delete('sms-phone')
  disconnectSmsPhone(
    @Param('organizationId') organizationId: string,
    @Req() req: any,
  ) {
    return this.vendorSms.disconnect(organizationId, req.user.userId);
  }

  @Get('contacts')
  listContacts(@Param('organizationId') organizationId: string, @Req() req: any) {
    return this.marketingService.listContacts(
      organizationId,
      req.user.userId,
      req.user.role,
    );
  }

  @Post('contacts')
  addContacts(
    @Param('organizationId') organizationId: string,
    @Req() req: any,
    @Body() dto: AddContactsDto,
  ) {
    return this.marketingService.addContacts(
      organizationId,
      req.user.userId,
      req.user.role,
      dto,
    );
  }

  @Delete('contacts/:contactId')
  removeContact(
    @Param('organizationId') organizationId: string,
    @Param('contactId') contactId: string,
    @Req() req: any,
  ) {
    return this.marketingService.removeContact(
      organizationId,
      contactId,
      req.user.userId,
      req.user.role,
    );
  }

  @Get('campaigns')
  listCampaigns(@Param('organizationId') organizationId: string, @Req() req: any) {
    return this.marketingService.listCampaigns(
      organizationId,
      req.user.userId,
      req.user.role,
    );
  }

  @Post('campaigns')
  sendCampaign(
    @Param('organizationId') organizationId: string,
    @Req() req: any,
    @Body() dto: CreateCampaignDto,
  ) {
    return this.marketingService.sendCampaign(
      organizationId,
      req.user.userId,
      req.user.role,
      dto,
    );
  }
}
