import { Module } from '@nestjs/common';
import { FraudDetectionService } from './fraud-detection.service.js';

@Module({
  providers: [FraudDetectionService],
  exports: [FraudDetectionService],
})
export class FraudModule {}
