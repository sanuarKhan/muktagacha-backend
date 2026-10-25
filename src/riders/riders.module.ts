import { Module } from '@nestjs/common';
import { RidersService } from './riders.service.js';
import { RidersController } from './riders.controller.js';

@Module({
  controllers: [RidersController],
  providers: [RidersService],
})
export class RidersModule {}
