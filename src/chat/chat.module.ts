import { Module } from '@nestjs/common';
import { ChatService } from './chat.service.js';
import { ChatController } from './chat.controller.js';
import { GroupsService } from './groups.service.js';
import { GroupsController } from './groups.controller.js';
import { DirectMessagesService } from './direct-messages.service.js';
import { DirectMessagesController } from './direct-messages.controller.js';
import { ChatGateway } from './chat.gateway.js';
import { CHAT_GATEWAY } from './chat.tokens.js';

@Module({
  controllers: [ChatController, GroupsController, DirectMessagesController],
  providers: [
    ChatService,
    GroupsService,
    DirectMessagesService,
    ChatGateway,
    // Alias so the three services can inject the gateway by token instead of
    // by class reference. See chat.tokens.ts — injecting the class directly
    // creates an ESM circular-import crash at boot ("Cannot access
    // 'ChatGateway' before initialization"). useExisting (not useClass) keeps
    // this the exact same singleton instance the gateway decorator registers,
    // so events emitted by the services reach real connected sockets.
    { provide: CHAT_GATEWAY, useExisting: ChatGateway },
  ],
  exports: [ChatGateway],
})
export class ChatModule {}
