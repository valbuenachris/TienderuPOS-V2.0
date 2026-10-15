import { Body, Controller, Get, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { CustomerContextGuard } from '../auth/customer-context.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PosRequest } from '../auth/auth.types';
import { CreateReviewDto } from './review.dto';
import { ReviewsService } from './reviews.service';

@Controller('customer/reviews')
@UseGuards(JwtAuthGuard, CustomerContextGuard)
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('product/:productId/average')
  average(@Req() request: PosRequest, @Param('productId', ParseIntPipe) productId: number) {
    return this.reviews.average(request.tenantId!, productId);
  }

  @Get(':productId')
  list(@Req() request: PosRequest, @Param('productId', ParseIntPipe) productId: number) {
    return this.reviews.list(request.tenantId!, productId);
  }

  @Post()
  create(@Req() request: PosRequest, @Body() body: CreateReviewDto) {
    return this.reviews.create(request.tenantId!, request.posCustomer!, body);
  }
}
