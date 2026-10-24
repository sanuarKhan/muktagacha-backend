import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto.js';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateCategoryDto) {
    const slug = slugify(dto.name);
    return this.prisma.category.create({
      data: {
        name: dto.name,
        slug,
        vertical: dto.vertical,
        parentId: dto.parentId,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  // Public: vendors and buyers both need this list - vendors to pick a
  // category when listing a product, buyers to filter when browsing.
  findAll(vertical?: string) {
    return this.prisma.category.findMany({
      where: {
        isActive: true,
        ...(vertical ? { vertical: vertical as any } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { children: { where: { isActive: true } } },
    });
  }

  update(id: string, dto: UpdateCategoryDto) {
    return this.prisma.category.update({ where: { id }, data: dto });
  }

  remove(id: string) {
    // Soft delete - products referencing this category keep their
    // historical categoryId, it just stops appearing in active lists.
    return this.prisma.category.update({
      where: { id },
      data: { isActive: false },
    });
  }
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base || 'category'}-${suffix}`;
}
