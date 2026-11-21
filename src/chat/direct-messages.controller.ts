import { Controller, Get, Post, Param, Body, UseGuards, Req, Query } from '@nestjs/common';
import { DirectMessagesService } from './direct-messages.service.js';
import { SendDirectMessageDto, StartDirectConversationDto } from './dto/chat.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

// Customer <-> customer messenger - either side can start a conversation
// freely (unlike /chat/conversations, which is buyer-initiated-only).
@Controller('direct-messages')
@UseGuards(JwtAuthGuard)
export class DirectMessagesController {
  constructor(private directMessages: DirectMessagesService) {}

  // "New chat" search: shops + people I share a group with (admin: anyone).
  @Get('contacts')
  contacts(@Req() req: any, @Query('q') q?: string) {
    return this.directMessages.contacts(req.user.userId, req.user.role, q);
  }

  @Get('conversations')
  listMyConversations(@Req() req: any) {
    return this.directMessages.listMyConversations(req.user.userId);
  }

  @Post('conversations')
  startConversation(@Req() req: any, @Body() dto: StartDirectConversationDto) {
    return this.directMessages.startConversation(req.user.userId, dto);
  }

  @Get('conversations/:id/messages')
  getMessages(@Req() req: any, @Param('id') id: string) {
    return this.directMessages.getMessages(id, req.user.userId);
  }

  @Post('conversations/:id/messages')
  sendMessage(@Req() req: any, @Param('id') id: string, @Body() dto: SendDirectMessageDto) {
    return this.directMessages.sendMessage(id, req.user.userId, dto);
  }

  @Post('conversations/:id/read')
  markRead(@Req() req: any, @Param('id') id: string) {
    return this.directMessages.markRead(id, req.user.userId);
  }
}
