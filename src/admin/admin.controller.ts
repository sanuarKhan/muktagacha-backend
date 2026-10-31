import { Controller, Get, Patch, Param, Body, UseGuards, Req } from '@nestjs/common';
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
      unresolvedFraudFlags,
      pendingVerifications,
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
      this.prisma.fraudFlag.count({ where: { resolved: false } }),
      this.prisma.organization.count({ where: { verificationStatus: 'PENDING_REVIEW' } }),
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
      unresolvedFraudFlags,
      pendingVerifications,
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

  // Admin-only: every order across every vendor, for the platform-wide
  // order management view (roadmap item 6: search/filter/status overview).
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('orders')
  async allOrders() {
    return this.prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        buyer: { select: { id: true, fullName: true, phone: true } },
        organization: { select: { id: true, name: true } },
        items: true,
      },
    });
  }

  // Fraud review queue - every automatically-flagged order an admin
  // hasn't resolved yet. Flags never block an order on their own; this is
  // purely the human-review surface where an admin decides what to do.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('fraud-flags')
  async fraudFlags() {
    return this.prisma.fraudFlag.findMany({
      where: { resolved: false },
      include: {
        order: {
          include: {
            buyer: { select: { id: true, fullName: true, phone: true, createdAt: true } },
            organization: { select: { id: true, name: true } },
            items: true,
          },
        },
      },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
    });
  }

  // Admin dismisses or acts on a flag - marks it resolved with an
  // optional note explaining what was done (e.g. "contacted buyer,
  // confirmed legitimate" or "cancelled order, buyer warned").
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('fraud-flags/:id/resolve')
  async resolveFraudFlag(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { note?: string },
  ) {
    return this.prisma.fraudFlag.update({
      where: { id },
      data: {
        resolved: true,
        resolvedAt: new Date(),
        resolvedById: req.user.userId,
        resolutionNote: body.note,
      },
    });
  }
}
