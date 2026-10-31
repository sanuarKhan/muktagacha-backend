import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  // Used for picking a gift recipient (and could be reused for the
  // customer-to-customer messenger's "start a new chat" flow later) -
  // search by name OR phone, returns only safe public fields.
  @Get('search')
  search(@Query('q') q: string) {
    return this.usersService.search(q ?? '');
  }
}
