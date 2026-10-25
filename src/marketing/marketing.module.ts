import { Module } from '@nestjs/common';
import { MarketingService } from './marketing.service.js';
import { MarketingController } from './marketing.controller.js';

@Module({
  controllers: [MarketingController],
  providers: [MarketingService],
})
export class MarketingModule {}
