import { randomBytes } from 'crypto';
import { Injectable, ForbiddenException, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateGroupDto, CreateTopicDto, CreatePostDto } from './dto/group.dto.js';
// NOTE: `import type` (not a value import) is deliberate and load-bearing.
// chat.gateway imports this service and this service needs the gateway back,
// so the two files form an ESM circular dependency. `forwardRef` alone fixes
// Nest's DI graph but NOT the module-evaluation order: with a value import,
// TypeScript's `emitDecoratorMetadata` emits
//   __metadata("design:paramtypes", [PrismaService, ChatGateway])
// which dereferences ChatGateway at module-eval time and crashed the whole
// app on boot with "Cannot access 'ChatGateway' before initialization".
// A type-only import is erased at compile time, so the cycle never has to
// resolve eagerly; we inject by string token (see CHAT_GATEWAY in
// chat.module.ts) instead of by class reference.
import type { ChatGateway } from './chat.gateway.js';
import { CHAT_GATEWAY } from './chat.tokens.js';

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

// Short, unguessable, URL-safe invite code (e.g. "k3P9xQ2mVa7d").
function newInviteCode() {
  return randomBytes(9).toString('base64url');
}

@Injectable()
export class GroupsService {
  constructor(
    private prisma: PrismaService,
    @Inject(CHAT_GATEWAY) private gateway: ChatGateway,
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
          isPrivate: !!dto.isPrivate,
          inviteCode: dto.isPrivate ? newInviteCode() : null,
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
  listGroups(area?: string, ward?: string, q?: string, sort?: string) {
    const query = (q ?? '').trim().slice(0, 60);
    return this.prisma.group.findMany({
      where: {
        isPrivate: false, // private groups are invite-only, never listed
        ...(area ? { area } : {}),
        ...(ward ? { ward } : {}),
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: 'insensitive' as const } },
                { description: { contains: query, mode: 'insensitive' as const } },
                { area: { contains: query, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      omit: { inviteCode: true },
      include: {
        creator: { select: SAFE_USER_SELECT },
        _count: { select: { members: true, topics: true } },
      },
      orderBy: sort === 'popular' ? [{ members: { _count: 'desc' } }, { createdAt: 'desc' }] : { createdAt: 'desc' },
      take: 100,
    });
  }

  // "My groups": the groups I'm a member of (owner first).
  async myGroups(userId: string) {
    const rows = await this.prisma.groupMember.findMany({
      where: { userId },
      include: {
        group: {
          include: {
            creator: { select: SAFE_USER_SELECT },
            _count: { select: { members: true, topics: true } },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });
    return rows
      .sort((a, b) => (a.role === 'OWNER' ? -1 : 0) - (b.role === 'OWNER' ? -1 : 0))
      .map(({ group: { inviteCode: _code, ...g }, role }) => ({ ...g, myRole: role }));
  }

  private async assertMember(groupId: string, userId: string) {
    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership) throw new ForbiddenException('Join this group first');
    return membership;
  }

  // Public page. Private groups are visible only to members or to someone
  // holding the right invite code — everyone else gets "not found" (we
  // don't even confirm a private group exists). The invite code itself is
  // returned only to the owner/moderators.
  async getGroup(groupId: string, userId?: string, invite?: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: {
        topics: { orderBy: { createdAt: 'asc' } },
        _count: { select: { members: true } },
      },
    });
    if (!group) throw new NotFoundException('Group not found');
    const membership = userId
      ? await this.prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } })
      : null;
    const inviteOk = !!invite && !!group.inviteCode && invite === group.inviteCode;
    if (group.isPrivate && !membership && !inviteOk) throw new NotFoundException('Group not found');

    const { inviteCode, topics, ...rest } = group;
    const canManage = membership?.role === 'OWNER' || membership?.role === 'MODERATOR';
    return {
      ...rest,
      topics: membership || !group.isPrivate ? topics : [],
      myRole: membership?.role ?? null,
      ...(canManage ? { inviteCode } : {}),
    };
  }

  async joinGroup(groupId: string, userId: string, invite?: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');
    if (group.isPrivate) {
      const already = await this.prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
      if (!already && (!invite || invite !== group.inviteCode)) {
        throw new ForbiddenException('This is a private group. Ask the owner for an invite link.');
      }
    }
    return this.prisma.groupMember.upsert({
      where: { groupId_userId: { groupId, userId } },
      update: {},
      create: { groupId, userId, role: 'MEMBER' },
    });
  }

  // ── Owner / moderator tools ─────────────────────────────────────────
  private async assertManager(groupId: string, userId: string, ownerOnly = false) {
    const m = await this.assertMember(groupId, userId);
    if (m.role !== 'OWNER' && (ownerOnly || m.role !== 'MODERATOR')) {
      throw new ForbiddenException(ownerOnly ? 'Only the group owner can do this' : 'Only the group owner or a moderator can do this');
    }
    return m;
  }

  async updateGroup(groupId: string, userId: string, dto: { name?: string; description?: string; isPrivate?: boolean }) {
    await this.assertManager(groupId, userId, true);
    const current = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!current) throw new NotFoundException('Group not found');
    const goingPrivate = dto.isPrivate === true && !current.isPrivate;
    const updated = await this.prisma.group.update({
      where: { id: groupId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
        ...(dto.isPrivate !== undefined ? { isPrivate: dto.isPrivate } : {}),
        ...(goingPrivate && !current.inviteCode ? { inviteCode: newInviteCode() } : {}),
      },
    });
    return updated;
  }

  /** New invite code — the old link stops working. */
  async resetInvite(groupId: string, userId: string) {
    await this.assertManager(groupId, userId, true);
    const g = await this.prisma.group.update({ where: { id: groupId }, data: { inviteCode: newInviteCode() } });
    return { inviteCode: g.inviteCode };
  }

  /** Invite code for owner/moderator (created on first use for public groups too). */
  async getInvite(groupId: string, userId: string) {
    await this.assertManager(groupId, userId);
    let g = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!g) throw new NotFoundException('Group not found');
    if (!g.inviteCode) g = await this.prisma.group.update({ where: { id: groupId }, data: { inviteCode: newInviteCode() } });
    return { inviteCode: g.inviteCode };
  }

  async listMembers(groupId: string, userId: string) {
    await this.assertMember(groupId, userId);
    return this.prisma.groupMember.findMany({
      where: { groupId, user: { deletedAt: null } },
      select: { userId: true, role: true, joinedAt: true, user: { select: SAFE_USER_SELECT } },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });
  }

  async removeMember(groupId: string, actorId: string, targetUserId: string) {
    const actor = await this.assertManager(groupId, actorId);
    const target = await this.prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: targetUserId } } });
    if (!target) throw new NotFoundException('Not a member');
    if (target.role === 'OWNER') throw new BadRequestException("The owner can't be removed");
    if (target.role === 'MODERATOR' && actor.role !== 'OWNER') throw new ForbiddenException('Only the owner can remove a moderator');
    await this.prisma.groupMember.delete({ where: { id: target.id } });
    const topics = await this.prisma.groupTopic.findMany({ where: { groupId }, select: { id: true } });
    this.gateway.removeUserFromRooms(targetUserId, topics.map((t) => `topic:${t.id}`));
    return { ok: true };
  }

  async setMemberRole(groupId: string, actorId: string, targetUserId: string, role: 'MODERATOR' | 'MEMBER') {
    await this.assertManager(groupId, actorId, true);
    const target = await this.prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: targetUserId } } });
    if (!target) throw new NotFoundException('Not a member');
    if (target.role === 'OWNER') throw new BadRequestException("The owner's role can't be changed");
    await this.prisma.groupMember.update({ where: { id: target.id }, data: { role } });
    return { ok: true };
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
