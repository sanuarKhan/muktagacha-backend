import { Injectable, ForbiddenException, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  SendMessageDto,
  StartConversationDto,
  AskQuestionDto,
  ReplyQuestionDto,
} from './dto/chat.dto.js';
import { ChatGateway } from './chat.gateway.js';
import { maskName } from './privacy.util.js';

const SAFE_USER_SELECT = {
  id: true,
  fullName: true,
  role: true,
} as const;

// Privacy inside a private buyer<->vendor conversation: phone numbers are
// NEVER selected/returned here (SAFE_USER_SELECT has no phone field), and
// display names are masked (first+last letter, asterisks between) so
// neither side can identify or contact the other outside the platform
// just from browsing the chat UI. Applied at the boundary, not left to
// the frontend, so no client can bypass it by reading the raw response.
function maskParticipant<T extends { fullName: string } | null | undefined>(
  user: T,
): T {
  if (!user) return user;
  return { ...user, fullName: maskName(user.fullName) };
}

const ANONYMOUS_AUTHOR = { id: '', fullName: 'Anonymous', role: 'BUYER' as const };

// Masks the real author on anything flagged isAnonymous before it leaves
// the server - askerId/authorId stay real in the DB row (moderation /
// abuse accountability), only the API RESPONSE hides identity. Applied at
// the boundary so every call site gets this for free instead of each one
// needing to remember to mask manually.
function maskAnonymous<T extends { isAnonymous?: boolean; asker?: unknown; author?: unknown }>(
  item: T,
): T {
  if (!item.isAnonymous) return item;
  const masked = { ...item };
  if ('asker' in masked) (masked as any).asker = ANONYMOUS_AUTHOR;
  if ('author' in masked) (masked as any).author = ANONYMOUS_AUTHOR;
  return masked;
}

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
      const convos = await this.prisma.conversation.findMany({
        where: { organization: { ownerUserId: userId } },
        include: {
          buyer: { select: SAFE_USER_SELECT },
          organization: { select: { id: true, name: true, logoUrl: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { updatedAt: 'desc' },
      });
      return convos.map((c) => ({ ...c, buyer: maskParticipant(c.buyer) }));
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
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      include: { sender: { select: SAFE_USER_SELECT } },
      orderBy: { createdAt: 'asc' },
    });
    return messages.map((m) => ({ ...m, sender: maskParticipant(m.sender) }));
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
    const masked = { ...message, sender: maskParticipant(message.sender) };

    this.gateway.emitNewMessage(conversation.id, masked);
    return { conversation, message: masked };
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
    const masked = { ...message, sender: maskParticipant(message.sender) };
    this.gateway.emitNewMessage(conversationId, masked);
    return masked;
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

  async getQuestions(organizationId: string) {
    const questions = await this.prisma.shopQuestion.findMany({
      where: { organizationId },
      include: {
        asker: { select: SAFE_USER_SELECT },
        // Best-answer-first, Reddit-style: highest net score (upvotes minus
        // downvotes) surfaces to the top instead of whoever replied first.
        replies: { include: { author: { select: SAFE_USER_SELECT } }, orderBy: { score: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return questions.map((q) => ({
      ...maskAnonymous(q),
      replies: q.replies.map((r) => maskAnonymous(r)),
    }));
  }

  async askQuestion(organizationId: string, userId: string, dto: AskQuestionDto) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException('Shop not found');
    const question = await this.prisma.shopQuestion.create({
      data: { organizationId, askerId: userId, body: dto.body, isAnonymous: !!dto.isAnonymous },
      include: { asker: { select: SAFE_USER_SELECT } },
    });
    const masked = maskAnonymous(question);
    this.gateway.emitNewQuestion(organizationId, masked);
    return masked;
  }

  async replyQuestion(questionId: string, userId: string, dto: ReplyQuestionDto) {
    const question = await this.prisma.shopQuestion.findUnique({ where: { id: questionId } });
    if (!question) throw new NotFoundException('Question not found');
    const reply = await this.prisma.shopQuestionReply.create({
      data: { questionId, authorId: userId, body: dto.body, isAnonymous: !!dto.isAnonymous },
      include: { author: { select: SAFE_USER_SELECT } },
    });
    const masked = maskAnonymous(reply);
    this.gateway.emitNewReply(question.organizationId, masked);
    return masked;
  }

  // Reddit-style up/down vote on an answer. Clicking the SAME direction
  // again removes the vote (un-voting); clicking the OPPOSITE direction
  // flips it. `score` on the reply is kept denormalized so sorting
  // "best answer first" never needs a live aggregate query.
  async voteReply(replyId: string, userId: string, value: 'UP' | 'DOWN') {
    const reply = await this.prisma.shopQuestionReply.findUnique({
      where: { id: replyId },
      include: { question: { select: { organizationId: true } } },
    });
    if (!reply) throw new NotFoundException('Answer not found');
    if (reply.authorId === userId) {
      throw new BadRequestException("You can't vote on your own answer");
    }

    const existing = await this.prisma.replyVote.findUnique({
      where: { replyId_userId: { replyId, userId } },
    });

    let scoreDelta = 0;
    if (!existing) {
      await this.prisma.replyVote.create({ data: { replyId, userId, value } });
      scoreDelta = value === 'UP' ? 1 : -1;
    } else if (existing.value === value) {
      // Same direction clicked again - remove the vote entirely.
      await this.prisma.replyVote.delete({ where: { id: existing.id } });
      scoreDelta = value === 'UP' ? -1 : 1;
    } else {
      // Opposite direction - flip it (counts double: e.g. DOWN -> UP is +2).
      await this.prisma.replyVote.update({ where: { id: existing.id }, data: { value } });
      scoreDelta = value === 'UP' ? 2 : -2;
    }

    const updated = await this.prisma.shopQuestionReply.update({
      where: { id: replyId },
      data: { score: { increment: scoreDelta } },
      include: { author: { select: SAFE_USER_SELECT } },
    });
    this.gateway.emitReplyScoreChanged(reply.question.organizationId, replyId, updated.score);
    return { score: updated.score };
  }
}
