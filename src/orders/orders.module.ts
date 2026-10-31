import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { OrdersController } from './orders.controller.js';
import { SkodePayModule } from '../skodepay/skodepay.module.js';
import { FraudModule } from '../fraud/fraud.module.js';

@Module({
  imports: [SkodePayModule, FraudModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
