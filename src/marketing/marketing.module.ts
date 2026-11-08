import { Module } from '@nestjs/common';
import { MarketingService } from './marketing.service.js';
import { VendorSmsService } from './vendor-sms.service.js';
import { MarketingController } from './marketing.controller.js';

@Module({
  controllers: [MarketingController],
  providers: [MarketingService, VendorSmsService],
  exports: [VendorSmsService],
})
export class MarketingModule {}
