import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SecretCryptoService } from '../crypto/secret-crypto.service.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';

@Injectable()
export class OrganizationsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private crypto: SecretCryptoService,
  ) {}

  create(ownerUserId: string, dto: CreateOrganizationDto) {
    return this.prisma.organization.create({
      data: {
        ownerUserId,
        name: dto.name,
        logoUrl: dto.logoUrl,
        vertical: dto.vertical,
        area: dto.area,
        ward: dto.ward,
        deliveryRadiusKm: dto.deliveryRadiusKm,
        bkashNumber: dto.bkashNumber,
        nagadNumber: dto.nagadNumber,
        approvalStatus: 'PENDING',
      },
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
  findApproved(filters: { area?: string; ward?: string; vertical?: string }) {
    return this.prisma.organization.findMany({
      where: {
        approvalStatus: 'APPROVED',
        ...(filters.area ? { area: filters.area } : {}),
        ...(filters.ward ? { ward: filters.ward } : {}),
        ...(filters.vertical ? { vertical: filters.vertical as any } : {}),
      },
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
