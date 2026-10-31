import { Controller, Get, Post, Delete, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { GroupsService } from './groups.service.js';
import { CreateGroupDto, CreateTopicDto, CreatePostDto } from './dto/group.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

@Controller('groups')
@UseGuards(JwtAuthGuard)
export class GroupsController {
  constructor(private groupsService: GroupsService) {}

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
