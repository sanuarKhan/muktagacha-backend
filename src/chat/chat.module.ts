import { Module } from '@nestjs/common';
import { ChatService } from './chat.service.js';
import { ChatController } from './chat.controller.js';
import { GroupsService } from './groups.service.js';
import { GroupsController } from './groups.controller.js';
import { DirectMessagesService } from './direct-messages.service.js';
import { DirectMessagesController } from './direct-messages.controller.js';
import { ChatGateway } from './chat.gateway.js';

@Module({
  controllers: [ChatController, GroupsController, DirectMessagesController],
  providers: [ChatService, GroupsService, DirectMessagesService, ChatGateway],
  exports: [ChatGateway],
})
export class ChatModule {}
