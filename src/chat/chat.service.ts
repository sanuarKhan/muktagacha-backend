import { Injectable, ForbiddenException, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  SendMessageDto,
  StartConversationDto,
  AskQuestionDto,
  ReplyQuestionDto,
} from './dto/chat.dto.js';
import { ChatGateway } from './chat.gateway.js';

const SAFE_USER_SELECT = {
  id: true,
  fullName: true,
  role: true,
} as const;

@Injectable()
export class ChatService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ChatGateway)) private gateway: ChatGateway,
  ) {}

  // ───────────────────────── Private conversations ─────────────────────────
  // Hard rule from the client: only a BUYER can open a NEW conversation with
  // a shop. A vendor can never cold-message a buyer - they can only reply
  // inside a conversation the buyer already started. Enforced here, not just
  // in the UI, since the API itself must refuse it even if someone calls it
  // directly.

  async listMyConversations(userId: string, role: string) {
    if (role === 'VENDOR') {
      // Vendor sees every conversation across all shops they own.
      return this.prisma.conversation.findMany({
        where: { organization: { ownerUserId: userId } },
        include: {
          buyer: { select: SAFE_USER_SELECT },
          organization: { select: { id: true, name: true, logoUrl: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { updatedAt: 'desc' },
      });
    }
    return this.prisma.conversation.findMany({
      where: { buyerId: userId },
      include: {
        organization: { select: { id: true, name: true, logoUrl: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private async assertConversationAccess(conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { organization: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const isBuyer = conversation.buyerId === userId;
    const isVendorOwner = conversation.organization.ownerUserId === userId;
    if (!isBuyer && !isVendorOwner) {
      throw new ForbiddenException("This isn't your conversation");
    }
    return conversation;
  }

  async getMessages(conversationId: string, userId: string) {
    await this.assertConversationAccess(conversationId, userId);
    return this.prisma.message.findMany({
      where: { conversationId },
      include: { sender: { select: SAFE_USER_SELECT } },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Buyer starts (or continues) a conversation with a shop by sending the
  // first message. Re-using @@unique([organizationId, buyerId]) means a
  // second "start" with the same shop just appends to the existing thread
  // instead of creating a duplicate one.
  async startConversation(buyerId: string, role: string, dto: StartConversationDto) {
    if (role !== 'BUYER') {
      throw new ForbiddenException('Only buyers can start a new conversation with a shop');
    }
    const org = await this.prisma.organization.findUnique({ where: { id: dto.organizationId } });
    if (!org) throw new NotFoundException('Shop not found');
    if (org.ownerUserId === buyerId) {
      throw new BadRequestException("You can't message your own shop");
    }

    const conversation = await this.prisma.conversation.upsert({
      where: { organizationId_buyerId: { organizationId: dto.organizationId, buyerId } },
      update: { updatedAt: new Date() },
      create: { organizationId: dto.organizationId, buyerId },
    });

    const message = await this.prisma.message.create({
      data: { conversationId: conversation.id, senderId: buyerId, body: dto.body },
      include: { sender: { select: SAFE_USER_SELECT } },
    });

    this.gateway.emitNewMessage(conversation.id, message);
    return { conversation, message };
  }

  // Reply inside an EXISTING conversation - works for both sides (buyer
  // replying to the vendor's answer, or vendor replying to the buyer).
  // A vendor can only post here if the conversation already exists, which
  // (per startConversation above) can only have been created by a buyer -
  // this is what makes "vendor can't message first" actually true end to end.
  async sendMessage(conversationId: string, userId: string, dto: SendMessageDto) {
    await this.assertConversationAccess(conversationId, userId);
    const message = await this.prisma.message.create({
      data: { conversationId, senderId: userId, body: dto.body },
      include: { sender: { select: SAFE_USER_SELECT } },
    });
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
    this.gateway.emitNewMessage(conversationId, message);
    return message;
  }

  async markRead(conversationId: string, userId: string) {
    await this.assertConversationAccess(conversationId, userId);
    // Mark as read every message in this conversation NOT sent by the
    // caller (reading your own messages is a no-op).
    await this.prisma.message.updateMany({
      where: { conversationId, senderId: { not: userId }, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  // ───────────────────────── Public shop Q&A board ─────────────────────────
  // Anyone (any logged-in user, any role) can ask or reply - this is the
  // "common place where everyone can chat" the client asked for: visible to
  // every visitor on the shop's storefront page, not just the asker/vendor.

  getQuestions(organizationId: string) {
    return this.prisma.shopQuestion.findMany({
      where: { organizationId },
      include: {
        asker: { select: SAFE_USER_SELECT },
        replies: { include: { author: { select: SAFE_USER_SELECT } }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async askQuestion(organizationId: string, userId: string, dto: AskQuestionDto) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException('Shop not found');
    const question = await this.prisma.shopQuestion.create({
      data: { organizationId, askerId: userId, body: dto.body },
      include: { asker: { select: SAFE_USER_SELECT } },
    });
    this.gateway.emitNewQuestion(organizationId, question);
    return question;
  }

  async replyQuestion(questionId: string, userId: string, dto: ReplyQuestionDto) {
    const question = await this.prisma.shopQuestion.findUnique({ where: { id: questionId } });
    if (!question) throw new NotFoundException('Question not found');
    const reply = await this.prisma.shopQuestionReply.create({
      data: { questionId, authorId: userId, body: dto.body },
      include: { author: { select: SAFE_USER_SELECT } },
    });
    this.gateway.emitNewReply(question.organizationId, reply);
    return reply;
  }
}
