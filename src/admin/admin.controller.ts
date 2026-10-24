import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';

@Controller('admin')
export class AdminController {
  constructor(private prisma: PrismaService) {}

  // Admin-only overview: counts across the whole platform, so the admin
  // panel shows real state (not just the bare pending-approvals queue).
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('stats')
  async stats() {
    const [
      totalUsers,
      totalVendors,
      approvedVendors,
      pendingVendors,
      rejectedVendors,
      totalProducts,
      activeProducts,
      totalOrders,
      pendingPaymentVerifications,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.organization.count(),
      this.prisma.organization.count({ where: { approvalStatus: 'APPROVED' } }),
      this.prisma.organization.count({ where: { approvalStatus: 'PENDING' } }),
      this.prisma.organization.count({ where: { approvalStatus: 'REJECTED' } }),
      this.prisma.product.count(),
      this.prisma.product.count({ where: { isActive: true } }),
      this.prisma.order.count(),
      this.prisma.order.count({ where: { paymentVerification: 'PENDING_VERIFICATION' } }),
    ]);
    return {
      totalUsers,
      totalVendors,
      approvedVendors,
      pendingVendors,
      rejectedVendors,
      totalProducts,
      activeProducts,
      totalOrders,
      pendingPaymentVerifications,
    };
  }

  // Admin-only: every approved vendor, for a full directory view (not just
  // the pending queue) so the admin can see everything live on the platform.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('vendors')
  async allVendors() {
    return this.prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: { owner: true, _count: { select: { listings: true } } },
    });
  }
}
