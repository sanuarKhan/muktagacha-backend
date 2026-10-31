import { Module } from '@nestjs/common';
import { ServiceRequestsService } from './service-requests.service.js';
import { ServiceRequestsController } from './service-requests.controller.js';
import { WalletsModule } from '../wallets/wallets.module.js';

@Module({
  imports: [WalletsModule],
  controllers: [ServiceRequestsController],
  providers: [ServiceRequestsService],
})
export class ServiceRequestsModule {}
