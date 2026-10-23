import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CreateOrderDto, UpdateOrderStatusDto } from './dto/order.dto.js';

const SAFE_BUYER_SELECT = {
  id: true,
  phone: true,
  fullName: true,
  role: true,
  area: true,
  ward: true,
} as const;

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async create(buyerId: string, dto: CreateOrderDto) {
    const order = await this.prisma.order.create({
      data: {
        buyerId,
        organizationId: dto.organizationId,
        paymentMethod: dto.paymentMethod,
        status: 'PENDING',
        items: {
          create: dto.items.map((item) => ({
            listingId: item.listingId,
            quantity: item.quantity,
            price: item.price,
          })),
        },
      },
      include: { items: true, buyer: { select: SAFE_BUYER_SELECT }, organization: true },
    });

    await this.notifications.notifyOrderCreated(order);
    return order;
  }

  findMine(buyerId: string) {
    return this.prisma.order.findMany({
      where: { buyerId },
      include: { items: true, organization: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  findByOrganization(organizationId: string) {
    return this.prisma.order.findMany({
      where: { organizationId },
      include: { items: true, buyer: { select: SAFE_BUYER_SELECT } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(
    orderId: string,
    userId: string,
    role: string,
    dto: UpdateOrderStatusDto,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { organization: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (role !== 'ADMIN' && order.organization.ownerUserId !== userId) {
      throw new ForbiddenException('Not your organization order');
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: dto.status },
      include: { buyer: { select: SAFE_BUYER_SELECT }, organization: true },
    });

    await this.notifications.notifyOrderStatusChanged(updated);
    return updated;
  }
}
