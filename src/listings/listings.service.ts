import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateListingDto, UpdateListingDto } from './dto/listing.dto.js';

@Injectable()
export class ListingsService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateListingDto) {
    return this.prisma.listing.create({
      data: {
        organizationId: dto.organizationId,
        type: dto.type,
        name: dto.name,
        price: dto.price,
        category: dto.category,
      },
    });
  }

  findByOrganization(organizationId: string) {
    return this.prisma.listing.findMany({ where: { organizationId } });
  }

  // Public browse: filter by vertical-equivalent type and category, only
  // active listings belonging to approved organizations
  findActive(filters: { type?: string; category?: string }) {
    return this.prisma.listing.findMany({
      where: {
        isActive: true,
        organization: { approvalStatus: 'APPROVED' },
        ...(filters.type ? { type: filters.type as any } : {}),
        ...(filters.category ? { category: filters.category } : {}),
      },
      include: { organization: true },
    });
  }

  update(id: string, dto: UpdateListingDto) {
    return this.prisma.listing.update({ where: { id }, data: dto });
  }

  remove(id: string) {
    // Soft delete pattern: mark inactive rather than hard-deleting, so order
    // history referencing this listing stays intact.
    return this.prisma.listing.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
