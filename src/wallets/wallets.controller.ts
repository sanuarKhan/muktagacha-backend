import { Controller, Get, Post, Patch, Param, Body, UseGuards, Req } from '@nestjs/common';
import { WalletsService } from './wallets.service.js';
import { RequestTopupDto } from './dto/wallet.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletsController {
  constructor(private walletsService: WalletsService) {}

  @Get('balance')
  getBalance(@Req() req: any) {
    return this.walletsService.getBalance(req.user.userId);
  }

  @Get('history')
  getHistory(@Req() req: any) {
    return this.walletsService.getHistory(req.user.userId);
  }

  @Post('topup')
  requestTopup(@Req() req: any, @Body() dto: RequestTopupDto) {
    return this.walletsService.requestTopup(req.user.userId, dto);
  }

  @Get('topups/mine')
  myTopups(@Req() req: any) {
    return this.walletsService.myTopups(req.user.userId);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Get('topups/pending')
  pendingTopups() {
    return this.walletsService.pendingTopups();
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Patch('topups/:id/review')
  reviewTopup(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { decision: 'VERIFIED' | 'REJECTED' },
  ) {
    return this.walletsService.reviewTopup(id, req.user.userId, body.decision);
  }
}
