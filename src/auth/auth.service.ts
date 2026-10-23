import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (existing) {
      throw new ConflictException('A user with this phone already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        phone: dto.phone,
        passwordHash,
        fullName: dto.fullName,
        role: dto.role ?? 'BUYER',
        area: dto.area,
        ward: dto.ward,
      },
      select: {
        id: true,
        phone: true,
        fullName: true,
        role: true,
        area: true,
        ward: true,
        createdAt: true,
      },
    });

    return { user, ...(await this.issueToken(user.id, user.phone, user.role)) };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Invalid phone or password');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid phone or password');
    }

    return {
      user: {
        id: user.id,
        phone: user.phone,
        fullName: user.fullName,
        role: user.role,
        area: user.area,
        ward: user.ward,
      },
      ...(await this.issueToken(user.id, user.phone, user.role)),
    };
  }

  private async issueToken(sub: string, phone: string, role: string) {
    const accessToken = await this.jwt.signAsync({ sub, phone, role });
    return { accessToken };
  }
}
