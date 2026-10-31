import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const SAFE_SEARCH_SELECT = {
  id: true,
  fullName: true,
  phone: true,
  role: true,
  area: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  // Minimum query length prevents a near-empty search from returning a
  // huge chunk of the user base (both a performance and a privacy
  // consideration - "find everyone" shouldn't be one keystroke away).
  async search(q: string) {
    const query = q.trim();
    if (query.length < 2) {
      throw new BadRequestException('Type at least 2 characters to search');
    }
    return this.prisma.user.findMany({
      where: {
        deletedAt: null,
        OR: [
          { fullName: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query } },
        ],
      },
      select: SAFE_SEARCH_SELECT,
      take: 15,
    });
  }
}
