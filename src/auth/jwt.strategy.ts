import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getJwtSecret } from './jwt-secret.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  async validate(payload: { sub: string; phone: string; role: string }) {
    // Tokens live 7 days — check the account still exists and wasn't
    // closed/deleted since the token was issued. Role comes from the DB so
    // a changed role takes effect immediately too.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, phone: true, role: true, deletedAt: true },
    });
    if (!user || user.deletedAt) throw new UnauthorizedException('This account no longer exists');
    return { userId: user.id, phone: user.phone, role: user.role };
  }
}
