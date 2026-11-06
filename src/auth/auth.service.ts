import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/password-reset.dto.js';

// Reset-code policy. Short expiry + low attempt cap is what makes a 6-digit
// code safe: 10 minutes and 5 guesses gives an attacker ~5 tries out of a
// million, instead of unlimited tries forever.
const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
// Don't let one phone number request unlimited SMS (cost + harassment vector).
const RESEND_COOLDOWN_SECONDS = 60;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private notifications: NotificationsService,
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

  // ------------------------------------------------------------------
  // Password reset — step 1: request a code
  // ------------------------------------------------------------------
  //
  // SECURITY: this ALWAYS returns the same success response, whether or not
  // the phone number belongs to a real account. Returning "no such user"
  // would turn this endpoint into a free user-enumeration oracle — anyone
  // could discover which phone numbers are registered on the platform.
  async forgotPassword(dto: ForgotPasswordDto) {
    const genericResponse = {
      ok: true,
      message:
        'If that phone number has an account, a reset code has been sent to it.',
    };

    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (!user || user.deletedAt) {
      // Deliberately silent: same response shape, no SMS sent.
      this.logger.warn(
        `Password reset requested for unknown/deleted phone: ${dto.phone}`,
      );
      return genericResponse;
    }

    // Throttle resends so one number can't be spammed with SMS.
    const recent = await this.prisma.passwordResetCode.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    if (
      recent &&
      Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_SECONDS * 1000
    ) {
      // Still the generic response — don't reveal the account exists.
      return genericResponse;
    }

    // Invalidate any still-valid earlier codes, so only the newest works.
    await this.prisma.passwordResetCode.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    // randomInt (crypto) not Math.random — a predictable reset code is the
    // same as no reset code at all.
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = await bcrypt.hash(code, 10);

    await this.prisma.passwordResetCode.create({
      data: {
        userId: user.id,
        codeHash,
        expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
      },
    });

    await this.notifications.sendSms(
      user.phone,
      `Your Muktagacha password reset code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes. If you did not request this, ignore this message.`,
    );

    return genericResponse;
  }

  // ------------------------------------------------------------------
  // Password reset — step 2: verify the code and set a new password
  // ------------------------------------------------------------------
  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    // Generic failure message throughout — never distinguish "no such user"
    // from "wrong code", for the same enumeration reason as above.
    const invalid = () =>
      new BadRequestException('Invalid or expired reset code');

    if (!user || user.deletedAt) throw invalid();

    const record = await this.prisma.passwordResetCode.findFirst({
      where: { userId: user.id, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) throw invalid();

    if (record.expiresAt.getTime() < Date.now()) {
      await this.prisma.passwordResetCode.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      throw invalid();
    }

    if (record.attempts >= MAX_ATTEMPTS) {
      // Burn the code rather than allowing endless guessing.
      await this.prisma.passwordResetCode.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      throw new BadRequestException(
        'Too many incorrect attempts. Please request a new code.',
      );
    }

    const matches = await bcrypt.compare(dto.code, record.codeHash);
    if (!matches) {
      await this.prisma.passwordResetCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw invalid();
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    // Consume the code and change the password together, so a failure
    // can't leave a used code still valid (or vice versa).
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
      this.prisma.passwordResetCode.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
    ]);

    // Courtesy notification: if this wasn't the owner, they find out.
    await this.notifications.sendSms(
      user.phone,
      'Your Muktagacha password was just changed. If this was not you, contact us immediately.',
    );

    return { ok: true, message: 'Password updated. You can now log in.' };
  }
}
