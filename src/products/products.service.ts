import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto.js';

const PRODUCT_INCLUDE = {
  images: { orderBy: { sortOrder: 'asc' as const } },
  variants: true,
  category: true,
  organization: true,
};

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateProductDto) {
    const slug = slugify(dto.name);
    return this.prisma.product.create({
      data: {
        organizationId: dto.organizationId,
        categoryId: dto.categoryId,
        name: dto.name,
        slug,
        description: dto.description,
        basePrice: dto.basePrice,
        hasVariants: dto.hasVariants ?? false,
        images: dto.images?.length
          ? {
              create: dto.images.map((img, i) => ({
                url: img.url,
                sortOrder: i,
              })),
            }
          : undefined,
        variants:
          dto.hasVariants && dto.variants?.length
            ? {
                create: dto.variants.map((v) => ({
                  sku: v.sku,
                  optionValues: v.optionValues,
                  priceOverride: v.priceOverride,
                  stockCount: v.stockCount,
                })),
              }
            : undefined,
      },
      include: PRODUCT_INCLUDE,
    });
  }

  findByOrganization(organizationId: string) {
    return this.prisma.product.findMany({
      where: { organizationId },
      include: PRODUCT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  // Public browse: only active products belonging to approved organizations
  findActive(filters: { categoryId?: string; vertical?: string; search?: string }) {
    return this.prisma.product.findMany({
      where: {
        isActive: true,
        organization: { approvalStatus: 'APPROVED' },
        ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
        ...(filters.vertical ? { organization: { approvalStatus: 'APPROVED', vertical: filters.vertical as any } } : {}),
        ...(filters.search
          ? { name: { contains: filters.search, mode: 'insensitive' as const } }
          : {}),
      },
      include: PRODUCT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string) {
    return this.prisma.product.findUnique({
      where: { id },
      include: PRODUCT_INCLUDE,
    });
  }

  update(id: string, dto: UpdateProductDto) {
    return this.prisma.product.update({
      where: { id },
      data: dto,
      include: PRODUCT_INCLUDE,
    });
  }

  remove(id: string) {
    // Soft delete: order history referencing this product must stay intact.
    return this.prisma.product.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // Admin-only comprehensive view: every product across every vendor,
  // for the real admin catalog page (search/filter/bulk operations).
  findAllForAdmin(filters: { search?: string; organizationId?: string }) {
    return this.prisma.product.findMany({
      where: {
        ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
        ...(filters.search
          ? { name: { contains: filters.search, mode: 'insensitive' as const } }
          : {}),
      },
      include: PRODUCT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  // Append a short random suffix so two vendors naming a product the
  // same thing ("Men's Panjabi") don't collide on the unique-ish slug.
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base || 'product'}-${suffix}`;
}
