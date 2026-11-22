import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ProductsService } from './products.service.js';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';

@Controller('products')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Get()
  findActive(
    @Query('categoryId') categoryId?: string,
    @Query('vertical') vertical?: string,
    @Query('search') search?: string,
  ) {
    return this.productsService.findActive({ categoryId, vertical, search });
  }

  @Get('organization/:organizationId')
  findByOrganization(@Param('organizationId') organizationId: string) {
    return this.productsService.findByOrganization(organizationId);
  }

  // Admin-only comprehensive catalog view across every vendor. Must be
  // declared BEFORE the generic ':id' route below, or Nest matches
  // 'admin' as an :id param and this handler is never reached.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('admin/all')
  findAllForAdmin(
    @Query('search') search?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.productsService.findAllForAdmin({ search, organizationId });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(@Req() req: any, @Body() dto: CreateProductDto) {
    await this.productsService.assertCanManageOrg(dto.organizationId, req.user);
    return this.productsService.create(dto);
  }

  // Stock screen: { variantId?, delta } or { variantId?, set: number|null }
  @UseGuards(JwtAuthGuard)
  @Patch(':id/stock')
  adjustStock(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { variantId?: string; delta?: number; set?: number | null },
  ) {
    return this.productsService.adjustStock(id, req.user, body ?? {});
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    await this.productsService.assertCanManageProduct(id, req.user);
    return this.productsService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    await this.productsService.assertCanManageProduct(id, req.user);
    return this.productsService.remove(id);
  }
}
