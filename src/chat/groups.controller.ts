import { Controller, Get, Post, Delete, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { GroupsService } from './groups.service.js';
import { CreateGroupDto, CreateTopicDto, CreatePostDto } from './dto/group.dto.js';
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
  listGroups(@Query('area') area?: string, @Query('ward') ward?: string) {
    return this.groupsService.listGroups(area, ward);
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

  // Public for the same reason as the list: a visitor must be able to open a
  // group and see what it is before deciding to join. Without this the
  // group page requested details with no token, got 401, and spun forever.
  // Topics and posts remain members-only.
  @Public()
  @Get(':id')
  getGroup(@Param('id') id: string) {
    return this.groupsService.getGroup(id);
  }

  @Post(':id/join')
  joinGroup(@Req() req: any, @Param('id') id: string) {
    return this.groupsService.joinGroup(id, req.user.userId);
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
