import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { OrdersController } from './orders.controller.js';
import { SkodePayModule } from '../skodepay/skodepay.module.js';

@Module({
  imports: [SkodePayModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
