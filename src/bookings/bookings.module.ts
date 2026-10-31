import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service.js';
import { BookingsController } from './bookings.controller.js';
import { WalletsModule } from '../wallets/wallets.module.js';

@Module({
  imports: [WalletsModule],
  controllers: [BookingsController],
  providers: [BookingsService],
})
export class BookingsModule {}
