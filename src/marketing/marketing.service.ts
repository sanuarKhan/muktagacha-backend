import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AddContactsDto, CreateCampaignDto } from './dto/marketing.dto.js';

async function assertOwnerOrAdmin(
  prisma: PrismaService,
  organizationId: string,
  userId: string,
  role: string,
) {
  if (role === 'ADMIN') return;
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new NotFoundException('Shop not found');
  if (org.ownerUserId !== userId) {
    throw new ForbiddenException("This isn't your shop");
  }
}

@Injectable()
export class MarketingService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async listContacts(organizationId: string, userId: string, role: string) {
    await assertOwnerOrAdmin(this.prisma, organizationId, userId, role);
    return this.prisma.marketingContact.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Upserts by (organizationId, phone) so re-uploading the same CSV twice
  // (e.g. an updated customer list) doesn't create duplicate rows - it
  // just refreshes the name if one was provided this time.
  async addContacts(
    organizationId: string,
    userId: string,
    role: string,
    dto: AddContactsDto,
  ) {
    await assertOwnerOrAdmin(this.prisma, organizationId, userId, role);
    const normalized = dto.contacts
      .map((c) => ({ ...c, phone: c.phone.replace(/[^\d+]/g, '') }))
      .filter((c) => c.phone.length >= 10);

    let added = 0;
    for (const c of normalized) {
      await this.prisma.marketingContact.upsert({
        where: { organizationId_phone: { organizationId, phone: c.phone } },
        update: c.name ? { name: c.name } : {},
        create: { organizationId, phone: c.phone, name: c.name },
      });
      added += 1;
    }
    return { added, skipped: dto.contacts.length - added };
  }

  async removeContact(organizationId: string, contactId: string, userId: string, role: string) {
    await assertOwnerOrAdmin(this.prisma, organizationId, userId, role);
    await this.prisma.marketingContact.delete({ where: { id: contactId } });
    return { ok: true };
  }

  async listCampaigns(organizationId: string, userId: string, role: string) {
    await assertOwnerOrAdmin(this.prisma, organizationId, userId, role);
    return this.prisma.marketingCampaign.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Sends synchronously (fine at this scale - a few hundred contacts max
  // per vendor pilot). Each SMS send result is tallied so the vendor sees
  // real sent/failed counts, not a black-box "queued" status. If no SMS
  // gateway is configured (HTTPSMS_API_KEY unset), every send is logged
  // and counted as failed - same honest-fallback pattern as order SMS.
  async sendCampaign(
    organizationId: string,
    userId: string,
    role: string,
    dto: CreateCampaignDto,
  ) {
    await assertOwnerOrAdmin(this.prisma, organizationId, userId, role);
    const contacts = await this.prisma.marketingContact.findMany({
      where: { organizationId },
    });

    const campaign = await this.prisma.marketingCampaign.create({
      data: {
        organizationId,
        message: dto.message,
        status: 'SENDING',
        recipientCount: contacts.length,
      },
    });

    let sent = 0;
    let failed = 0;
    for (const contact of contacts) {
      const ok = await this.notifications.sendSms(contact.phone, dto.message);
      if (ok) sent += 1;
      else failed += 1;
    }

    return this.prisma.marketingCampaign.update({
      where: { id: campaign.id },
      data: {
        status: sent > 0 ? 'SENT' : 'FAILED',
        sentCount: sent,
        failedCount: failed,
        sentAt: new Date(),
      },
    });
  }
}
