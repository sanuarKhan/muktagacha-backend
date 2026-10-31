import { Injectable, ForbiddenException, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SendDirectMessageDto, StartDirectConversationDto } from './dto/chat.dto.js';
import { ChatGateway } from './chat.gateway.js';
import { maskName } from './privacy.util.js';

const SAFE_USER_SELECT = {
  id: true,
  fullName: true,
  role: true,
} as const;

// Same privacy rule as the buyer<->vendor conversations: phone numbers are
// never selected, and names are masked so two customers chatting through
// the platform can't identify each other by full name either.
function maskParticipant<T extends { fullName: string } | null | undefined>(
  user: T,
): T {
  if (!user) return user;
  return { ...user, fullName: maskName(user.fullName) };
}

// Customer <-> customer messaging, like a normal messenger. Unlike the
// buyer-vendor Conversation model, EITHER side can start this freely - no
// "only one side can initiate" restriction, since this isn't a sales
// channel, it's peer discussion (most commonly two buyers who met through
// a community Group or a shop's public Q&A board).
@Injectable()
export class DirectMessagesService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ChatGateway)) private gateway: ChatGateway,
  ) {}

  // Always store the pair sorted so (A,B) and (B,A) can never both exist -
  // the @@unique([userAId, userBId]) constraint only protects one order.
  private sortPair(x: string, y: string): [string, string] {
    return x < y ? [x, y] : [y, x];
  }

  listMyConversations(userId: string) {
    return this.prisma.directConversation
      .findMany({
        where: { OR: [{ userAId: userId }, { userBId: userId }] },
        include: {
          userA: { select: SAFE_USER_SELECT },
          userB: { select: SAFE_USER_SELECT },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { updatedAt: 'desc' },
      })
      .then((convos) =>
        convos.map((c) => ({
          ...c,
          userA: maskParticipant(c.userA),
          userB: maskParticipant(c.userB),
        })),
      );
  }

  private async assertAccess(conversationId: string, userId: string) {
    const conversation = await this.prisma.directConversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.userAId !== userId && conversation.userBId !== userId) {
      throw new ForbiddenException("This isn't your conversation");
    }
    return conversation;
  }

  async getMessages(conversationId: string, userId: string) {
    await this.assertAccess(conversationId, userId);
    const messages = await this.prisma.directMessage.findMany({
      where: { conversationId },
      include: { sender: { select: SAFE_USER_SELECT } },
      orderBy: { createdAt: 'asc' },
    });
    return messages.map((m) => ({ ...m, sender: maskParticipant(m.sender) }));
  }

  async startConversation(userId: string, dto: StartDirectConversationDto) {
    if (dto.recipientId === userId) {
      throw new BadRequestException("You can't message yourself");
    }
    const recipient = await this.prisma.user.findUnique({ where: { id: dto.recipientId } });
    if (!recipient) throw new NotFoundException('User not found');

    const [userAId, userBId] = this.sortPair(userId, dto.recipientId);
    const conversation = await this.prisma.directConversation.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      update: { updatedAt: new Date() },
      create: { userAId, userBId },
    });

    const message = await this.prisma.directMessage.create({
      data: { conversationId: conversation.id, senderId: userId, body: dto.body },
      include: { sender: { select: SAFE_USER_SELECT } },
    });
    const masked = { ...message, sender: maskParticipant(message.sender) };

    this.gateway.emitNewDirectMessage(conversation.id, masked);
    return { conversation, message: masked };
  }

  async sendMessage(conversationId: string, userId: string, dto: SendDirectMessageDto) {
    await this.assertAccess(conversationId, userId);
    const message = await this.prisma.directMessage.create({
      data: { conversationId, senderId: userId, body: dto.body },
      include: { sender: { select: SAFE_USER_SELECT } },
    });
    await this.prisma.directConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
    const masked = { ...message, sender: maskParticipant(message.sender) };
    this.gateway.emitNewDirectMessage(conversationId, masked);
    return masked;
  }

  async markRead(conversationId: string, userId: string) {
    await this.assertAccess(conversationId, userId);
    await this.prisma.directMessage.updateMany({
      where: { conversationId, senderId: { not: userId }, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}
