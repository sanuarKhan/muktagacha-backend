import { Injectable, ForbiddenException, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateGroupDto, CreateTopicDto, CreatePostDto } from './dto/group.dto.js';
import { ChatGateway } from './chat.gateway.js';

const SAFE_USER_SELECT = {
  id: true,
  fullName: true,
  role: true,
} as const;

const ANONYMOUS_AUTHOR = { id: '', fullName: 'Anonymous', role: 'BUYER' as const };

function maskAnonymous<T extends { isAnonymous?: boolean; author?: unknown }>(item: T): T {
  if (!item.isAnonymous) return item;
  return { ...item, author: ANONYMOUS_AUTHOR };
}

@Injectable()
export class GroupsService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ChatGateway)) private gateway: ChatGateway,
  ) {}

  // Discord-style: any logged-in user can create a group, becomes its
  // OWNER, is auto-joined, and a default "General" topic is created so the
  // group isn't empty on arrival.
  async createGroup(userId: string, dto: CreateGroupDto) {
    return this.prisma.$transaction(async (tx) => {
      const group = await tx.group.create({
        data: {
          name: dto.name,
          description: dto.description,
          area: dto.area,
          ward: dto.ward,
          creatorId: userId,
        },
      });
      await tx.groupMember.create({
        data: { groupId: group.id, userId, role: 'OWNER' },
      });
      await tx.groupTopic.create({
        data: { groupId: group.id, name: 'General', creatorId: userId },
      });
      return group;
    });
  }

  // Discovery list: all groups, optionally scoped to an area/ward so
  // residents can find their own neighborhood's groups first. Open
  // discovery (not members-only) - joining is one click, matching how
  // Discord server discovery / public communities work.
  listGroups(area?: string, ward?: string) {
    return this.prisma.group.findMany({
      where: { ...(area ? { area } : {}), ...(ward ? { ward } : {}) },
      include: {
        creator: { select: SAFE_USER_SELECT },
        _count: { select: { members: true, topics: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async assertMember(groupId: string, userId: string) {
    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership) throw new ForbiddenException('Join this group first');
    return membership;
  }

  async getGroup(groupId: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: {
        topics: { orderBy: { createdAt: 'asc' } },
        _count: { select: { members: true } },
      },
    });
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  async joinGroup(groupId: string, userId: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');
    return this.prisma.groupMember.upsert({
      where: { groupId_userId: { groupId, userId } },
      update: {},
      create: { groupId, userId, role: 'MEMBER' },
    });
  }

  async leaveGroup(groupId: string, userId: string) {
    const membership = await this.assertMember(groupId, userId);
    if (membership.role === 'OWNER') {
      throw new BadRequestException(
        'The group owner cannot leave - transfer ownership or delete the group instead',
      );
    }
    await this.prisma.groupMember.delete({ where: { id: membership.id } });
    return { ok: true };
  }

  // Any member can create a new topic (channel) under a group they've
  // joined - matches the "people will create their own group own message
  // topics" request, so topic creation isn't owner/moderator-gated.
  async createTopic(groupId: string, userId: string, dto: CreateTopicDto) {
    await this.assertMember(groupId, userId);
    try {
      return await this.prisma.groupTopic.create({
        data: { groupId, name: dto.name, creatorId: userId },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new BadRequestException(`A topic named "${dto.name}" already exists in this group`);
      }
      throw err;
    }
  }

  async getTopics(groupId: string, userId: string) {
    await this.assertMember(groupId, userId);
    return this.prisma.groupTopic.findMany({
      where: { groupId },
      include: { creator: { select: SAFE_USER_SELECT }, _count: { select: { posts: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getPosts(topicId: string, userId: string) {
    const topic = await this.prisma.groupTopic.findUnique({ where: { id: topicId } });
    if (!topic) throw new NotFoundException('Topic not found');
    await this.assertMember(topic.groupId, userId);
    const posts = await this.prisma.groupPost.findMany({
      where: { topicId },
      include: { author: { select: SAFE_USER_SELECT } },
      orderBy: { createdAt: 'asc' },
    });
    return posts.map((p) => maskAnonymous(p));
  }

  async createPost(topicId: string, userId: string, dto: CreatePostDto) {
    const topic = await this.prisma.groupTopic.findUnique({ where: { id: topicId } });
    if (!topic) throw new NotFoundException('Topic not found');
    await this.assertMember(topic.groupId, userId);
    const post = await this.prisma.groupPost.create({
      data: { topicId, authorId: userId, body: dto.body, isAnonymous: !!dto.isAnonymous },
      include: { author: { select: SAFE_USER_SELECT } },
    });
    const masked = maskAnonymous(post);
    this.gateway.emitNewPost(topicId, masked);
    return masked;
  }
}
