import { Controller, Get, Post, Param, Body, UseGuards, Req } from '@nestjs/common';
import { ChatService } from './chat.service.js';
import {
  SendMessageDto,
  StartConversationDto,
  AskQuestionDto,
  ReplyQuestionDto,
} from './dto/chat.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Get('conversations')
  listMyConversations(@Req() req: any) {
    return this.chatService.listMyConversations(req.user.userId, req.user.role);
  }

  @Post('conversations')
  startConversation(@Req() req: any, @Body() dto: StartConversationDto) {
    return this.chatService.startConversation(req.user.userId, req.user.role, dto);
  }

  @Get('conversations/:id/messages')
  getMessages(@Req() req: any, @Param('id') id: string) {
    return this.chatService.getMessages(id, req.user.userId);
  }

  @Post('conversations/:id/messages')
  sendMessage(@Req() req: any, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.chatService.sendMessage(id, req.user.userId, dto);
  }

  @Post('conversations/:id/read')
  markRead(@Req() req: any, @Param('id') id: string) {
    return this.chatService.markRead(id, req.user.userId);
  }

  // Public shop Q&A board - GET is intentionally outside the guard-free
  // path would be nicer for anonymous browsing, but the class-level guard
  // keeps this consistent with the rest of the app (all data behind login).
  @Get('shops/:organizationId/questions')
  getQuestions(@Param('organizationId') organizationId: string) {
    return this.chatService.getQuestions(organizationId);
  }

  @Post('shops/:organizationId/questions')
  askQuestion(
    @Req() req: any,
    @Param('organizationId') organizationId: string,
    @Body() dto: AskQuestionDto,
  ) {
    return this.chatService.askQuestion(organizationId, req.user.userId, dto);
  }

  @Post('questions/:id/replies')
  replyQuestion(@Req() req: any, @Param('id') id: string, @Body() dto: ReplyQuestionDto) {
    return this.chatService.replyQuestion(id, req.user.userId, dto);
  }
}
