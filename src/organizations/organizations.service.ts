import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SecretCryptoService } from '../crypto/secret-crypto.service.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { PUBLIC_ORG_SELECT } from './public-org.select.js';

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
    return this.prisma.organization.findMany({ where: { ownerUserId } });
  }

  // Admin-only: list organizations awaiting review
  findPending() {
    return this.prisma.organization.findMany({
      where: { approvalStatus: 'PENDING' },
      orderBy: { createdAt: 'asc' },
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
      data: { approvalStatus: 'APPROVED' },
    });
    await this.notifications.notifyVendorApproved(org.owner.phone, org.name);
    return updated;
  }

  async reject(id: string) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');
    return this.prisma.organization.update({
      where: { id },
      data: { approvalStatus: 'REJECTED' },
    });
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
