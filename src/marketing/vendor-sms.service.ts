import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SecretCryptoService } from '../crypto/secret-crypto.service.js';

/**
 * Per-vendor SMS phone connection.
 *
 * Each vendor links their OWN Android phone to the shared gateway, so their
 * marketing SMS is sent from THEIR number and billed to THEIR SIM bundle.
 *
 * Why this matters: without it, every vendor's campaign goes out through the
 * single platform phone. One number messaging every shop's customers is what
 * carriers flag as spam — it risks the platform SIM being disconnected, and
 * customers would see an unfamiliar number instead of the shop they know.
 */
@Injectable()
export class VendorSmsService {
  private readonly logger = new Logger(VendorSmsService.name);

  constructor(
    private prisma: PrismaService,
    private crypto: SecretCryptoService,
  ) {}

  private gatewayUrl(): string {
    const url = process.env.SMS_GATEWAY_URL;
    if (!url) {
      throw new BadRequestException(
        'SMS gateway is not configured on the server',
      );
    }
    return url.replace(/\/$/, '');
  }

  private async ownedOrg(orgId: string, userId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('Shop not found');
    // Ownership check: a vendor must never be able to read or change another
    // shop's sending credentials.
    if (org.ownerUserId !== userId) {
      throw new ForbiddenException('You do not own this shop');
    }
    return org;
  }

  /**
   * Status for the vendor dashboard.
   * Deliberately never returns the password — only whether a phone is linked
   * and whether the gateway has seen it recently.
   */
  async getStatus(orgId: string, userId: string) {
    const org = await this.ownedOrg(orgId, userId);

    if (!org.smsGatewayLogin || !org.smsGatewayPassword) {
      return {
        connected: false,
        phone: null,
        linkedAt: null,
        online: false,
        message: 'No phone connected yet.',
      };
    }

    // Probe the gateway so the UI can distinguish "set up but phone is off"
    // from "working" — the former silently stops SMS and is the most common
    // real-world failure.
    let online = false;
    try {
      const password = this.crypto.decrypt(org.smsGatewayPassword);
      const auth = Buffer.from(
        `${org.smsGatewayLogin}:${password}`,
      ).toString('base64');
      const res = await fetch(`${this.gatewayUrl()}/api/3rdparty/v1/health`, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(10_000),
      });
      online = res.ok;
    } catch (err) {
      this.logger.warn(
        `Gateway health probe failed for org ${orgId}: ${(err as Error).message}`,
      );
    }

    return {
      connected: true,
      phone: org.smsGatewayPhone,
      linkedAt: org.smsGatewayLinkedAt,
      online,
      message: online
        ? 'Phone connected and reachable.'
        : 'Phone is linked but not responding — make sure the app is running and the phone has network.',
    };
  }

  /**
   * Save the credentials the vendor copied out of the Android app, after
   * verifying they actually work. Verifying first means a typo surfaces
   * immediately instead of silently breaking every future campaign.
   */
  async connect(
    orgId: string,
    userId: string,
    login: string,
    password: string,
    phone?: string,
  ) {
    await this.ownedOrg(orgId, userId);

    if (!login?.trim() || !password?.trim()) {
      throw new BadRequestException('Username and password are required');
    }

    const auth = Buffer.from(`${login.trim()}:${password.trim()}`).toString(
      'base64',
    );
    let ok = false;
    try {
      const res = await fetch(`${this.gatewayUrl()}/api/3rdparty/v1/health`, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(15_000),
      });
      ok = res.ok;
    } catch (err) {
      throw new BadRequestException(
        `Could not reach the SMS gateway: ${(err as Error).message}`,
      );
    }

    if (!ok) {
      throw new BadRequestException(
        'Those credentials were rejected by the gateway. Copy the username and password exactly as shown in the app.',
      );
    }

    await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        smsGatewayLogin: login.trim(),
        smsGatewayPassword: this.crypto.encrypt(password.trim()),
        smsGatewayPhone: phone?.trim() || null,
        smsGatewayLinkedAt: new Date(),
      },
    });

    return { ok: true, message: 'Phone connected successfully.' };
  }

  async disconnect(orgId: string, userId: string) {
    await this.ownedOrg(orgId, userId);
    await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        smsGatewayLogin: null,
        smsGatewayPassword: null,
        smsGatewayPhone: null,
        smsGatewayLinkedAt: null,
      },
    });
    return { ok: true, message: 'Phone disconnected.' };
  }

  /**
   * Send through a specific vendor's phone.
   * Returns null when the vendor has not connected one, so callers can give a
   * precise error rather than silently falling back to the platform number.
   */
  async sendAsVendor(
    orgId: string,
    to: string,
    message: string,
  ): Promise<boolean | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org?.smsGatewayLogin || !org?.smsGatewayPassword) return null;

    try {
      const password = this.crypto.decrypt(org.smsGatewayPassword);
      const auth = Buffer.from(
        `${org.smsGatewayLogin}:${password}`,
      ).toString('base64');

      const res = await fetch(`${this.gatewayUrl()}/api/3rdparty/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({
          message,
          phoneNumbers: [this.toE164(to)],
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        this.logger.error(
          `Vendor SMS failed (org ${orgId}): ${res.status} ${(await res.text()).slice(0, 160)}`,
        );
        return false;
      }
      return true;
    } catch (err) {
      this.logger.error(
        `Vendor SMS error (org ${orgId}): ${(err as Error).message}`,
      );
      return false;
    }
  }

  /** Numbers are stored as 01XXXXXXXXX; the gateway requires E.164. */
  private toE164(phone: string): string {
    const trimmed = phone.trim();
    if (trimmed.startsWith('+')) return trimmed;
    const digits = trimmed.replace(/\D/g, '');
    if (digits.startsWith('880')) return `+${digits}`;
    if (digits.startsWith('0')) return `+880${digits.slice(1)}`;
    return `+880${digits}`;
  }
}
