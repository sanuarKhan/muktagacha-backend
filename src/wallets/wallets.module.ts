import { Module } from '@nestjs/common';
import { WalletsService } from './wallets.service.js';
import { WalletsController } from './wallets.controller.js';

@Module({
  controllers: [WalletsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
