import { Module } from '@nestjs/common';
import { SkodePayService } from './skodepay.service.js';

@Module({
  providers: [SkodePayService],
  exports: [SkodePayService],
})
export class SkodePayModule {}
