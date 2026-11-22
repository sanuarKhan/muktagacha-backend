import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto.js';
import { PUBLIC_ORG_SELECT } from '../organizations/public-org.select.js';

const PRODUCT_INCLUDE = {
  images: { orderBy: { sortOrder: 'asc' as const } },
  variants: true,
  category: true,
  organization: { select: PUBLIC_ORG_SELECT },
};

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  // SECURITY: only the shop's owner (or an admin) may create/edit/delete
  // its products. Previously any logged-in account could change any shop's
  // products, because the routes only checked "is logged in".
  async assertCanManageOrg(organizationId: string, user: { userId: string; role: string }) {
    if (user.role === 'ADMIN') return;
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { ownerUserId: true } });
    if (!org) throw new NotFoundException('Shop not found');
    if (org.ownerUserId !== user.userId) throw new ForbiddenException("You can only manage your own shop's products");
  }

  async assertCanManageProduct(productId: string, user: { userId: string; role: string }) {
    const p = await this.prisma.product.findUnique({ where: { id: productId }, select: { organizationId: true } });
    if (!p) throw new NotFoundException('Product not found');
    await this.assertCanManageOrg(p.organizationId, user);
    return p;
  }

  /**
   * Stock screen: set an exact number, add/remove pieces, or switch to
   * "always available" (stockCount null). Works on a product without
   * options, or on one size/colour (variantId).
   */
  async adjustStock(
    productId: string,
    user: { userId: string; role: string },
    body: { variantId?: string; delta?: number; set?: number | null },
  ) {
    await this.assertCanManageProduct(productId, user);
    const hasSet = Object.prototype.hasOwnProperty.call(body, 'set');
    if (!hasSet && (typeof body.delta !== 'number' || !Number.isInteger(body.delta) || body.delta === 0)) {
      throw new BadRequestException('Send a whole number change, or an exact number');
    }
    if (hasSet && body.set !== null && (!Number.isInteger(body.set) || (body.set as number) < 0)) {
      throw new BadRequestException('Stock must be 0 or more');
    }

    if (body.variantId) {
      const v = await this.prisma.productVariant.findFirst({ where: { id: body.variantId, productId } });
      if (!v) throw new NotFoundException('Option not found');
      if (hasSet) {
        await this.prisma.productVariant.update({ where: { id: v.id }, data: { stockCount: body.set ?? null } });
      } else {
        const next = Math.max(0, (v.stockCount ?? 0) + (body.delta as number));
        await this.prisma.productVariant.update({ where: { id: v.id }, data: { stockCount: next } });
      }
    } else {
      const p = await this.prisma.product.findUnique({ where: { id: productId } });
      if (!p) throw new NotFoundException('Product not found');
      if (hasSet) {
        await this.prisma.product.update({ where: { id: productId }, data: { stockCount: body.set ?? null } });
      } else {
        const next = Math.max(0, (p.stockCount ?? 0) + (body.delta as number));
        await this.prisma.product.update({ where: { id: productId }, data: { stockCount: next } });
      }
    }
    return this.findOne(productId);
  }

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
        stockCount: dto.hasVariants ? null : (dto.stockCount ?? null),
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
                  stockCount: v.stockCount ?? null,
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
                stockCount: v.stockCount ?? null,
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
                stockCount: v.stockCount ?? null,
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
