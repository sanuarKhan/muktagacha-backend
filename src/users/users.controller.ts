import { Controller, Get, Delete, Param, Query, Req, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { AccountDeletionService } from './account-deletion.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private usersService: UsersService,
    private deletion: AccountDeletionService,
  ) {}

  // Used for picking a gift recipient (and could be reused for the
  // customer-to-customer messenger's "start a new chat" flow later) -
  // search by name OR phone, returns only safe public fields.
  @Get('search')
  search(@Query('q') q: string) {
    return this.usersService.search(q ?? '');
  }

  // ── Close my own account ───────────────────────────────────────────
  @Get('me/delete-preview')
  myDeletePreview(@Req() req: any) {
    return this.deletion.preview(req.user.userId);
  }

  @Delete('me')
  deleteMe(@Req() req: any) {
    return this.deletion.deleteAccount(req.user.userId, req.user);
  }

  // ── Admin: users list + delete any account ─────────────────────────
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Get('admin/list')
  adminList(@Query('q') q?: string) {
    return this.usersService.adminList(q);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Get('admin/:id/delete-preview')
  adminDeletePreview(@Param('id', ParseUUIDPipe) id: string) {
    return this.deletion.preview(id);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Delete('admin/:id')
  adminDelete(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.deletion.deleteAccount(id, req.user);
  }
}
