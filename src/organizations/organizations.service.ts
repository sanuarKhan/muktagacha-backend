import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SecretCryptoService } from '../crypto/secret-crypto.service.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { PUBLIC_ORG_SELECT } from './public-org.select.js';

// Secrets never leave the server — not even to the shop's own owner or an
// admin (they're write-only: the settings screens send new values in).
export const OWNER_HIDDEN_FIELDS = {
  cloudinaryApiSecretEnc: true,
  skodePayApiKeyEnc: true,
  smsGatewayPassword: true,
} as const;

// Shop links live at /shop/<slug>. Block words that would be confusing or
// that impersonate the platform itself.
const RESERVED_SLUGS = new Set([
  'admin', 'api', 'login', 'register', 'vendor', 'vendors', 'shop', 'shops',
  'muktagacha', 'support', 'help', 'checkout', 'cart', 'orders', 'wallet',
  'rider', 'new', 'edit', 'settings', 'official',
]);

/** Lowercase, ASCII letters/digits/hyphens only, max 40 chars. */
export function normaliseSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

@Injectable()
export class OrganizationsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private crypto: SecretCryptoService,
  ) {}

  async create(ownerUserId: string, dto: CreateOrganizationDto) {
    return this.prisma.organization.create({
      data: {
        ownerUserId,
        name: dto.name,
        // Every shop gets a shareable /shop/<slug> link from day one; the
        // vendor can change it later from their dashboard.
        slug: await this.uniqueSlugFor(dto.name),
        logoUrl: dto.logoUrl,
        vertical: dto.vertical,
        area: dto.area,
        ward: dto.ward,
        deliveryRadiusKm: dto.deliveryRadiusKm,
        bkashNumber: dto.bkashNumber,
        nagadNumber: dto.nagadNumber,
        latitude: dto.latitude,
        longitude: dto.longitude,
        approvalStatus: 'PENDING',
      },
    });
  }

  async updateLocation(
    id: string,
    userId: string,
    role: string,
    data: { latitude: number; longitude: number },
  ) {
    await this.assertOwnerOrAdmin(id, userId, role);
    return this.prisma.organization.update({
      where: { id },
      data: { latitude: data.latitude, longitude: data.longitude },
    });
  }

  async updatePaymentNumbers(
    id: string,
    userId: string,
    role: string,
    data: { bkashNumber?: string; nagadNumber?: string },
  ) {
    await this.assertOwnerOrAdmin(id, userId, role);
    return this.prisma.organization.update({ where: { id }, data });
  }

  // Vendor connects their own SkodePay merchant account (API key from
  // their SkodePay dashboard). Stored encrypted at rest - same pattern
  // as the Cloudinary secret. Returns the org WITHOUT the plaintext key
  // (never echo a secret back, even to its owner, outside the moment
  // they typed it).
  async updateSkodePaySettings(
    id: string,
    userId: string,
    role: string,
    data: { apiKey?: string; enabled?: boolean },
  ) {
    await this.assertOwnerOrAdmin(id, userId, role);
    const updateData: Record<string, unknown> = {};
    if (data.apiKey) {
      updateData.skodePayApiKeyEnc = this.crypto.encrypt(data.apiKey);
    }
    if (typeof data.enabled === 'boolean') {
      updateData.skodePayEnabled = data.enabled;
    }
    const updated = await this.prisma.organization.update({
      where: { id },
      data: updateData,
    });
    const { skodePayApiKeyEnc, cloudinaryApiSecretEnc, ...safe } = updated;
    return safe;
  }

  findMine(ownerUserId: string) {
    return this.prisma.organization.findMany({
      where: { ownerUserId },
      omit: OWNER_HIDDEN_FIELDS,
    });
  }

  // Admin-only: list organizations awaiting review
  findPending() {
    return this.prisma.organization.findMany({
      where: { approvalStatus: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      omit: OWNER_HIDDEN_FIELDS,
    });
  }

  // Public: browse approved organizations, optionally scoped by area/ward/vertical
  /**
   * Build a free slug from a shop name: "TS Fashion" -> "ts-fashion", then
   * "ts-fashion-2" etc. if taken. Bengali-only names have no ASCII letters,
   * so they fall back to "shop-<random>" — the vendor can rename it.
   */
  async uniqueSlugFor(name: string, excludeId?: string): Promise<string> {
    let base = normaliseSlug(name);
    if (base.length < 3 || RESERVED_SLUGS.has(base)) {
      base = `shop-${Math.random().toString(36).slice(2, 7)}`;
    }
    for (let n = 1; n < 50; n++) {
      const candidate = n === 1 ? base : `${base}-${n}`.slice(0, 40);
      const taken = await this.prisma.organization.findFirst({
        where: { slug: candidate, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    return `${base.slice(0, 30)}-${Date.now().toString(36)}`;
  }

  findApproved(filters: { area?: string; ward?: string; vertical?: string }) {
    return this.prisma.organization.findMany({
      where: {
        approvalStatus: 'APPROVED',
        ...(filters.area ? { area: filters.area } : {}),
        ...(filters.ward ? { ward: filters.ward } : {}),
        ...(filters.vertical ? { vertical: filters.vertical as any } : {}),
      },
      // Public endpoint: never return the full row (it holds API keys,
      // the SMS gateway password and NID photos). See PUBLIC_ORG_SELECT.
      select: PUBLIC_ORG_SELECT,
    });
  }

  /**
   * Public shop page data, by slug OR id. Accepting the id too means a link
   * keeps working for shops that haven't chosen a custom web address yet,
   * and old links survive if a vendor later changes their slug.
   */
  async findPublicShop(slugOrId: string) {
    const org = await this.prisma.organization.findFirst({
      where: {
        approvalStatus: 'APPROVED',
        OR: [{ slug: slugOrId.toLowerCase() }, { id: slugOrId }],
      },
      select: PUBLIC_ORG_SELECT,
    });
    if (!org) throw new NotFoundException('Shop not found');

    const products = await this.prisma.product.findMany({
      where: { organizationId: org.id, isActive: true },
      include: {
        images: { orderBy: { sortOrder: 'asc' } },
        variants: true,
        category: true,
        organization: { select: PUBLIC_ORG_SELECT },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { shop: org, products };
  }

  /**
   * Vendor edits their own shop page: web address, banner, tagline,
   * description and social links.
   */
  async updateShopPage(
    id: string,
    userId: string,
    role: string,
    data: {
      slug?: string;
      name?: string;
      logoUrl?: string | null;
      bannerUrl?: string | null;
      tagline?: string | null;
      description?: string | null;
      facebookUrl?: string | null;
      whatsappNumber?: string | null;
    },
  ) {
    await this.assertOwnerOrAdmin(id, userId, role);
    const update: Record<string, unknown> = {};

    if (data.slug !== undefined) {
      const slug = normaliseSlug(data.slug);
      if (slug.length < 3) {
        throw new BadRequestException('Shop link must be at least 3 letters or numbers.');
      }
      if (RESERVED_SLUGS.has(slug)) {
        throw new BadRequestException('That shop link is reserved. Please choose another.');
      }
      const taken = await this.prisma.organization.findFirst({
        where: { slug, NOT: { id } },
        select: { id: true },
      });
      if (taken) throw new BadRequestException('That shop link is already taken. Try another.');
      update.slug = slug;
    }

    if (data.name !== undefined) {
      const name = data.name.trim();
      if (name.length < 2) throw new BadRequestException('Shop name is too short.');
      update.name = name.slice(0, 80);
    }

    const text = (v: string | null | undefined, max: number) =>
      v === undefined ? undefined : v === null ? null : v.trim().slice(0, max) || null;

    if (data.logoUrl !== undefined) update.logoUrl = text(data.logoUrl, 1000);
    if (data.bannerUrl !== undefined) update.bannerUrl = text(data.bannerUrl, 1000);
    if (data.tagline !== undefined) update.tagline = text(data.tagline, 120);
    if (data.description !== undefined) update.description = text(data.description, 2000);

    if (data.facebookUrl !== undefined) {
      const fb = text(data.facebookUrl, 300);
      if (fb && !/^https?:\/\/([a-z0-9-]+\.)?(facebook\.com|fb\.com|fb\.me)\//i.test(fb)) {
        throw new BadRequestException('Facebook link must start with https://facebook.com/');
      }
      update.facebookUrl = fb;
    }
    if (data.whatsappNumber !== undefined) {
      const wa = text(data.whatsappNumber, 20);
      if (wa && !/^\+?\d{10,15}$/.test(wa.replace(/[\s-]/g, ''))) {
        throw new BadRequestException('WhatsApp number looks invalid. Use digits only, e.g. 01712345678.');
      }
      update.whatsappNumber = wa ? wa.replace(/[\s-]/g, '') : null;
    }

    return this.prisma.organization.update({
      where: { id },
      data: update,
      select: PUBLIC_ORG_SELECT,
    });
  }

  async approve(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: { owner: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    const updated = await this.prisma.organization.update({
      where: { id },
      data: { approvalStatus: 'APPROVED', approvalNote: null },
      omit: OWNER_HIDDEN_FIELDS,
    });
    await this.notifications.notifyVendorApproved(org.owner.phone, org.name);
    return updated;
  }

  async reject(id: string, note?: string) {
    const org = await this.prisma.organization.findUnique({ where: { id }, include: { owner: true } });
    if (!org) throw new NotFoundException('Organization not found');
    const reason = note?.trim().slice(0, 500) || null;
    const updated = await this.prisma.organization.update({
      where: { id },
      data: { approvalStatus: 'REJECTED', approvalNote: reason },
      omit: OWNER_HIDDEN_FIELDS,
    });
    await this.notifications.notifyVendorRejected(org.owner.phone, org.name, reason);
    return updated;
  }

  // Vendor fixed their shop after a rejection → back into the admin's
  // pending queue. Only the owner, only from REJECTED.
  async resubmit(id: string, userId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org || org.ownerUserId !== userId) throw new ForbiddenException('Not your organization');
    if (org.approvalStatus !== 'REJECTED') {
      throw new BadRequestException('Only a rejected shop can be sent for review again.');
    }
    return this.prisma.organization.update({
      where: { id },
      data: { approvalStatus: 'PENDING', approvalNote: null },
      omit: OWNER_HIDDEN_FIELDS,
    });
  }

  // ── Admin: full control over any shop ───────────────────────────────

  // Change status in any direction (e.g. un-reject, suspend an approved
  // shop by sending it back to PENDING/REJECTED).
  async setStatus(id: string, status: 'PENDING' | 'APPROVED' | 'REJECTED', note?: string) {
    if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) throw new BadRequestException('Invalid status');
    if (status === 'APPROVED') return this.approve(id);
    if (status === 'REJECTED') return this.reject(id, note);
    const org = await this.prisma.organization.findUnique({ where: { id }, select: { id: true } });
    if (!org) throw new NotFoundException('Organization not found');
    return this.prisma.organization.update({
      where: { id },
      data: { approvalStatus: 'PENDING', approvalNote: null },
      omit: OWNER_HIDDEN_FIELDS,
    });
  }

  // Admin edits the basic shop details on the vendor's behalf.
  async adminUpdate(
    id: string,
    data: {
      name?: string;
      vertical?: string;
      area?: string | null;
      ward?: string | null;
      deliveryRadiusKm?: number | null;
      bkashNumber?: string | null;
      nagadNumber?: string | null;
      logoUrl?: string | null;
      tagline?: string | null;
      description?: string | null;
      facebookUrl?: string | null;
      whatsappNumber?: string | null;
    },
  ) {
    const org = await this.prisma.organization.findUnique({ where: { id }, select: { id: true } });
    if (!org) throw new NotFoundException('Organization not found');
    const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) || null : v === null ? null : undefined);
    const update: Record<string, unknown> = {};
    if (data.name !== undefined) {
      const name = String(data.name).trim();
      if (name.length < 2) throw new BadRequestException('Shop name is too short.');
      update.name = name.slice(0, 120);
    }
    if (data.vertical !== undefined) {
      if (!['MARKETPLACE', 'PHARMACY', 'SERVICES'].includes(String(data.vertical))) throw new BadRequestException('Invalid shop type');
      update.vertical = data.vertical;
    }
    if (data.deliveryRadiusKm !== undefined) {
      const r = data.deliveryRadiusKm === null ? null : Number(data.deliveryRadiusKm);
      if (r !== null && (!Number.isFinite(r) || r < 0 || r > 999)) throw new BadRequestException('Invalid delivery radius');
      update.deliveryRadiusKm = r;
    }
    for (const [k, max] of [['area', 80], ['ward', 80], ['bkashNumber', 20], ['nagadNumber', 20], ['logoUrl', 1000], ['tagline', 160], ['description', 3000], ['facebookUrl', 300], ['whatsappNumber', 20]] as const) {
      const v = text((data as any)[k], max);
      if (v !== undefined) update[k] = v;
    }
    return this.prisma.organization.update({ where: { id }, data: update, omit: OWNER_HIDDEN_FIELDS });
  }

  // Delete a shop. A shop with orders / bookings / service requests keeps
  // its history for buyers and accounting, so it can't be hard-deleted —
  // reject it instead (hidden from the site). An empty shop is removed
  // with its products and shop-only data.
  async adminDelete(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      select: { id: true, name: true, _count: { select: { orders: true, serviceRequests: true, bookingSlots: true, shopReviews: true } } },
    });
    if (!org) throw new NotFoundException('Organization not found');
    const c = org._count;
    if (c.orders || c.serviceRequests || c.bookingSlots || c.shopReviews) {
      throw new BadRequestException(
        `"${org.name}" has orders, bookings or reviews, so it can't be deleted (their history must be kept). Reject it instead — it will be hidden from the website.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({ where: { organizationId: id }, select: { id: true } });
      const productIds = products.map((p) => p.id);
      if (productIds.length) {
        // Order items reference products without cascade; an empty shop has
        // no orders, so these are only safety for stray rows.
        await tx.orderItem.deleteMany({ where: { productId: { in: productIds } } });
        await tx.product.deleteMany({ where: { id: { in: productIds } } });
      }
      await tx.conversation.deleteMany({ where: { organizationId: id } });
      await tx.shopQuestion.deleteMany({ where: { organizationId: id } });
      await tx.organization.delete({ where: { id } });
    });
    return { deleted: true, name: org.name };
  }

  // ───────────────────────── Vendor trust verification ─────────────────────────
  // Optional, separate from approval. Vendor uploads a trade license
  // and/or NID photo (already hosted via the existing Cloudinary signing
  // flow - this just records the resulting URLs) - at least ONE is
  // required to move past UNVERIFIED, both are accepted if the vendor
  // wants to submit both for a stronger review.
  async submitVerification(
    id: string,
    userId: string,
    role: string,
    data: { tradeLicenseUrl?: string; nidUrl?: string },
  ) {
    await this.assertOwnerOrAdmin(id, userId, role);
    if (!data.tradeLicenseUrl && !data.nidUrl) {
      throw new ForbiddenException(
        'Upload at least a trade license or an NID photo to request verification',
      );
    }
    return this.prisma.organization.update({
      where: { id },
      data: {
        tradeLicenseUrl: data.tradeLicenseUrl,
        nidUrl: data.nidUrl,
        verificationStatus: 'PENDING_REVIEW',
        // Clear any stale rejection note from a prior failed attempt -
        // this is a fresh submission.
        verificationNote: null,
      },
    });
  }

  // Admin-only: shops waiting on a verification review.
  findPendingVerifications() {
    return this.prisma.organization.findMany({
      where: { verificationStatus: 'PENDING_REVIEW' },
      omit: OWNER_HIDDEN_FIELDS,
      include: { owner: { select: { id: true, fullName: true, phone: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async verify(id: string, adminUserId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');
    return this.prisma.organization.update({
      where: { id },
      data: {
        verificationStatus: 'VERIFIED',
        verifiedAt: new Date(),
        verifiedById: adminUserId,
      },
    });
  }

  async rejectVerification(id: string, adminUserId: string, note?: string) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');
    return this.prisma.organization.update({
      where: { id },
      data: {
        verificationStatus: 'REJECTED',
        verifiedAt: new Date(),
        verifiedById: adminUserId,
        verificationNote: note,
      },
    });
  }

  async assertOwnerOrAdmin(orgId: string, userId: string, role: string) {
    if (role === 'ADMIN') return;
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org || org.ownerUserId !== userId) {
      throw new ForbiddenException('Not your organization');
    }
  }
}
