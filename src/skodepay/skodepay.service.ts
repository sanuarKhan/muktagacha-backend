import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SecretCryptoService } from '../crypto/secret-crypto.service.js';

const SKODEPAY_BASE_URL = 'https://qberyzxzzkrtsdggveuu.supabase.co';

export interface SkodePayCheckout {
  ref: string;
  checkoutUrl: string;
}

// Thin client for the vendor's own SkodePay account. SkodePay is
// Skode Digital's own payment-verification product - this is a real
// API integration, not a mock. The vendor pastes their API key (from
// their SkodePay dashboard -> Settings -> API Keys) into Muktagacha's
// Shop Settings; Muktagacha then creates a hosted-checkout transaction
// on THEIR account for each order, so the money still flows directly
// to the vendor the same way bKash/Nagad does - SkodePay just adds a
// proper hosted payment page plus auto-verification, instead of the
// buyer manually typing a TrxID.
@Injectable()
export class SkodePayService {
  constructor(
    private prisma: PrismaService,
    private secretCrypto: SecretCryptoService,
  ) {}

  async getApiKeyForOrg(organizationId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { skodePayApiKeyEnc: true, skodePayEnabled: true },
    });
    if (!org?.skodePayEnabled || !org.skodePayApiKeyEnc) {
      throw new BadRequestException(
        'SkodePay is not connected for this shop. Ask the vendor to add their ' +
          'SkodePay API key in Settings first.',
      );
    }
    return this.secretCrypto.decrypt(org.skodePayApiKeyEnc);
  }

  async createCheckout(
    organizationId: string,
    amount: number,
    buyerName: string,
    buyerPhone: string,
    orderId: string,
  ): Promise<SkodePayCheckout> {
    const apiKey = await this.getApiKeyForOrg(organizationId);

    const res = await fetch(`${SKODEPAY_BASE_URL}/functions/v1/create-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        amount,
        currency: 'BDT',
        customer: { name: buyerName, mobile: buyerPhone },
        metadata: { muktagacha_order_id: orderId },
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.success === false) {
      throw new BadRequestException(
        data.message ||
          data.error ||
          'Could not start SkodePay checkout. Check the vendor has an active payment gateway configured in their SkodePay dashboard.',
      );
    }

    return { ref: data.ref, checkoutUrl: data.checkout_url };
  }

  // Polls SkodePay for the current status of a transaction - used so
  // Muktagacha's own order status can reflect a payment that completed
  // on SkodePay's side (buyer paid, SkodePay auto-matched the SMS).
  async checkStatus(organizationId: string, ref: string): Promise<string> {
    const apiKey = await this.getApiKeyForOrg(organizationId);
    const res = await fetch(
      `${SKODEPAY_BASE_URL}/functions/v1/verify-payment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ ref }),
      },
    );
    const data = await res.json().catch(() => ({}));
    return data.transaction?.status || 'pending';
  }
}
