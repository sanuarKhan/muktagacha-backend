import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { GroupsService } from './groups.service.js';
import { CreateGroupDto, CreateTopicDto, CreatePostDto, UpdateGroupDto, JoinGroupDto, UpdateTopicDto } from './dto/group.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Public } from '../auth/public.decorator.js';

@Controller('groups')
@UseGuards(JwtAuthGuard)
export class GroupsController {
  constructor(private groupsService: GroupsService) {}

  // Browsing groups is intentionally PUBLIC — this is a discovery list, the
  // same idea as public Discord server discovery. Requiring a token here
  // meant the community page silently rendered "No groups yet" for everyone,
  // including logged-out visitors, even when groups existed in the database.
  // Creating, joining and posting still require auth.
  @Public()
  @Get()
  listGroups(
    @Query('area') area?: string,
    @Query('ward') ward?: string,
    @Query('q') q?: string,
    @Query('sort') sort?: string,
  ) {
    return this.groupsService.listGroups(area, ward, q, sort);
  }

  // Before ':id' so "mine" isn't read as a group id.
  @Get('mine')
  myGroups(@Req() req: any) {
    return this.groupsService.myGroups(req.user.userId);
  }

  @Post()
  createGroup(@Req() req: any, @Body() dto: CreateGroupDto) {
    return this.groupsService.createGroup(req.user.userId, dto);
  }

  // Declared BEFORE ':id' so NestJS doesn't treat "topics" as a group id -
  // route matching is in declaration order, most-specific-first.
  @Get('topics/:topicId/posts')
  getPosts(@Req() req: any, @Param('topicId') topicId: string) {
    return this.groupsService.getPosts(topicId, req.user.userId);
  }

  @Post('topics/:topicId/posts')
  createPost(@Req() req: any, @Param('topicId') topicId: string, @Body() dto: CreatePostDto) {
    return this.groupsService.createPost(topicId, req.user.userId, dto);
  }

  @Patch('topics/:topicId')
  updateTopic(@Req() req: any, @Param('topicId') topicId: string, @Body() dto: UpdateTopicDto) {
    return this.groupsService.updateTopic(topicId, req.user.userId, dto);
  }

  @Get('posts/:postId/file')
  fileLink(@Req() req: any, @Param('postId') postId: string) {
    return this.groupsService.fileLink(postId, req.user.userId);
  }

  // Public for the same reason as the list: a visitor must be able to open a
  // group and see what it is before deciding to join. Without this the
  // group page requested details with no token, got 401, and spun forever.
  // Topics and posts remain members-only.
  @Public()
  @Get(':id')
  getGroup(@Req() req: any, @Param('id') id: string, @Query('invite') invite?: string) {
    return this.groupsService.getGroup(id, req.user?.userId, invite);
  }

  @Post(':id/join')
  joinGroup(@Req() req: any, @Param('id') id: string, @Body() dto: JoinGroupDto) {
    return this.groupsService.joinGroup(id, req.user.userId, dto?.invite);
  }

  // ── owner / moderator ──
  @Patch(':id')
  updateGroup(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateGroupDto) {
    return this.groupsService.updateGroup(id, req.user.userId, dto);
  }

  @Get(':id/invite')
  getInvite(@Req() req: any, @Param('id') id: string) {
    return this.groupsService.getInvite(id, req.user.userId);
  }

  @Post(':id/invite/reset')
  resetInvite(@Req() req: any, @Param('id') id: string) {
    return this.groupsService.resetInvite(id, req.user.userId);
  }

  @Get(':id/upload-signature')
  uploadSignature(@Req() req: any, @Param('id') id: string) {
    return this.groupsService.uploadSignature(id, req.user.userId);
  }

  @Get(':id/members')
  listMembers(@Req() req: any, @Param('id') id: string) {
    return this.groupsService.listMembers(id, req.user.userId);
  }

  @Delete(':id/members/:userId')
  removeMember(@Req() req: any, @Param('id') id: string, @Param('userId') userId: string) {
    return this.groupsService.removeMember(id, req.user.userId, userId);
  }

  @Patch(':id/members/:userId')
  setMemberRole(@Req() req: any, @Param('id') id: string, @Param('userId') userId: string, @Body() body: { role: 'MODERATOR' | 'MEMBER' }) {
    return this.groupsService.setMemberRole(id, req.user.userId, userId, body?.role === 'MODERATOR' ? 'MODERATOR' : 'MEMBER');
  }

  @Delete(':id/leave')
  leaveGroup(@Req() req: any, @Param('id') id: string) {
    return this.groupsService.leaveGroup(id, req.user.userId);
  }

  @Get(':id/topics')
  getTopics(@Req() req: any, @Param('id') id: string) {
    return this.groupsService.getTopics(id, req.user.userId);
  }

  @Post(':id/topics')
  createTopic(@Req() req: any, @Param('id') id: string, @Body() dto: CreateTopicDto) {
    return this.groupsService.createTopic(id, req.user.userId, dto);
  }
}
