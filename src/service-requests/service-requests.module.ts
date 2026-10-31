import { Module } from '@nestjs/common';
import { ServiceRequestsService } from './service-requests.service.js';
import { ServiceRequestsController } from './service-requests.controller.js';

@Module({
  controllers: [ServiceRequestsController],
  providers: [ServiceRequestsService],
})
export class ServiceRequestsModule {}
