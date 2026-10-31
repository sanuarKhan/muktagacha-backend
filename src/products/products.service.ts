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
        requiresPrescription: dto.requiresPrescription ?? false,
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

  // Images: simple replace-all (delete old rows, create new ones) - safe
  // because ProductImage has no foreign keys pointing at it from Order/
  // OrderItem, so deleting old image rows can't orphan order history.
  //
  // Variants: NOT delete-and-recreate, because OrderItem.variantId
  // references ProductVariant - destroying a variant that's already on
  // a past order would corrupt that order's history. Instead, variants
  // are upserted by id when the edit form sends one back (existing
  // variant being edited) and created fresh when it has no id (new
  // variant added during this edit). Any existing variant NOT present
  // in the incoming list is soft-disabled (isActive: false) rather than
  // deleted, so old orders can still resolve it.
  async update(id: string, dto: UpdateProductDto) {
    const { images, variants, ...rest } = dto;

    return this.prisma.$transaction(async (tx) => {
      if (images) {
        await tx.productImage.deleteMany({ where: { productId: id } });
        if (images.length) {
          await tx.productImage.createMany({
            data: images.map((img, i) => ({ productId: id, url: img.url, sortOrder: i })),
          });
        }
      }

      if (variants) {
        const existing = await tx.productVariant.findMany({ where: { productId: id } });
        const incomingIds = new Set(
          variants.filter((v) => v.id).map((v) => v.id as string),
        );

        // Disable any existing variant the vendor removed from the form,
        // rather than deleting it (preserves past order references).
        for (const old of existing) {
          if (!incomingIds.has(old.id)) {
            await tx.productVariant.update({
              where: { id: old.id },
              data: { isActive: false },
            });
          }
        }

        for (const v of variants) {
          if (v.id) {
            await tx.productVariant.update({
              where: { id: v.id },
              data: {
                sku: v.sku,
                optionValues: v.optionValues,
                priceOverride: v.priceOverride,
                stockCount: v.stockCount,
                isActive: true,
              },
            });
          } else {
            await tx.productVariant.create({
              data: {
                productId: id,
                sku: v.sku,
                optionValues: v.optionValues,
                priceOverride: v.priceOverride,
                stockCount: v.stockCount,
              },
            });
          }
        }
      }

      return tx.product.update({
        where: { id },
        data: rest,
        include: PRODUCT_INCLUDE,
      });
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
