import { Controller, Get, Post, Param, Body, UseGuards, Req } from '@nestjs/common';
import { ReviewsService } from './reviews.service.js';
import { CreateShopReviewDto } from './dto/review.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

@Controller()
export class ReviewsController {
  constructor(private reviewsService: ReviewsService) {}

  @Get('organizations/:organizationId/reviews')
  findByOrganization(@Param('organizationId') organizationId: string) {
    return this.reviewsService.findByOrganization(organizationId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('orders/:id/review')
  reviewOrder(@Req() req: any, @Param('id') id: string, @Body() dto: CreateShopReviewDto) {
    return this.reviewsService.reviewOrder(id, req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('service-requests/:id/review')
  reviewServiceRequest(@Req() req: any, @Param('id') id: string, @Body() dto: CreateShopReviewDto) {
    return this.reviewsService.reviewServiceRequest(id, req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('bookings/:id/review')
  reviewSlotBooking(@Req() req: any, @Param('id') id: string, @Body() dto: CreateShopReviewDto) {
    return this.reviewsService.reviewSlotBooking(id, req.user.userId, dto);
  }
}
