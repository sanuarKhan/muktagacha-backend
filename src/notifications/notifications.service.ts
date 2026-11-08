import { Injectable, Logger } from '@nestjs/common';

// SMS wrapper with two possible backends.
//
// PRIMARY: our own self-hosted SMS gateway (capcom6 / sms-gate.app) running
// on the Skode VPS, which relays to an Android phone over a live SSE stream.
// Cost per message is zero and there is no monthly cap.
//
// FALLBACK: httpSMS, the original integration. Kept so a misconfigured
// gateway degrades instead of going dark — but note its free tier caps at
// 200 messages/month, which is why it is no longer primary.
//
// Why this change: httpSMS started returning 401 ("Make sure your API key is
// set in the [x-api-key] header") in production, so password-reset codes were
// generated but never delivered. Users could not reset their password at all.
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  async sendSms(to: string, message: string): Promise<boolean> {
    // Our own gateway first.
    if (await this.sendViaGateway(to, message)) return true;
    // Then the legacy provider, if it is still configured.
    return this.sendViaHttpSms(to, message);
  }

  /**
   * Self-hosted gateway. Expects:
   *   SMS_GATEWAY_URL      e.g. https://sms-gw.example.com
   *   SMS_GATEWAY_LOGIN    device username shown in the Android app
   *   SMS_GATEWAY_PASSWORD device password shown in the Android app
   */
  private async sendViaGateway(to: string, message: string): Promise<boolean> {
    const base = process.env.SMS_GATEWAY_URL;
    const login = process.env.SMS_GATEWAY_LOGIN;
    const password = process.env.SMS_GATEWAY_PASSWORD;

    if (!base || !login || !password) return false;

    try {
      const auth = Buffer.from(`${login}:${password}`).toString('base64');
      const res = await fetch(
        `${base.replace(/\/$/, '')}/api/3rdparty/v1/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${auth}`,
          },
          body: JSON.stringify({
            message,
            // The gateway requires E.164. Local BD numbers are stored as
            // 01XXXXXXXXX, so normalise before sending or the phone rejects it.
            phoneNumbers: [this.toE164(to)],
          }),
          // The VPS sits behind a tunnel; fail fast rather than hanging the
          // request that triggered this notification.
          signal: AbortSignal.timeout(15_000),
        },
      );

      if (!res.ok) {
        this.logger.error(
          `Gateway SMS failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
        );
        return false;
      }
      return true;
    } catch (err) {
      this.logger.error(`Gateway SMS error: ${(err as Error).message}`);
      return false;
    }
  }

  /** Legacy httpSMS path — fallback only. */
  private async sendViaHttpSms(to: string, message: string): Promise<boolean> {
    const apiKey = process.env.HTTPSMS_API_KEY;
    const from = process.env.HTTPSMS_FROM;

    if (!apiKey || !from) {
      this.logger.warn(`SMS not sent (no backend configured): to=${to}`);
      return false;
    }

    try {
      const res = await fetch('https://api.httpsms.com/v1/messages/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({ from, to: this.toE164(to), content: message }),
      });
      if (!res.ok) {
        this.logger.error(`SMS send failed: ${res.status} ${await res.text()}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.error(`SMS send error: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Normalise a Bangladeshi number to E.164.
   * Accepts 01XXXXXXXXX, 8801XXXXXXXXX, +8801XXXXXXXXX and returns
   * +8801XXXXXXXXX. Anything already starting with + is passed through.
   */
  private toE164(phone: string): string {
    const trimmed = phone.trim();
    if (trimmed.startsWith('+')) return trimmed;

    const digits = trimmed.replace(/\D/g, '');
    if (digits.startsWith('880')) return `+${digits}`;
    if (digits.startsWith('0')) return `+880${digits.slice(1)}`;
    return `+880${digits}`;
  }

  async notifyOrderCreated(order: any) {
    const phone = order.buyer?.phone;
    if (!phone) return;
    await this.sendSms(
      phone,
      `Your order at ${order.organization?.name ?? 'the vendor'} has been placed and is pending confirmation.`,
    );
  }

  async notifyOrderStatusChanged(order: any) {
    const phone = order.buyer?.phone;
    if (!phone) return;
    await this.sendSms(
      phone,
      `Your order status at ${order.organization?.name ?? 'the vendor'} changed to: ${order.status}.`,
    );
  }

  async notifyVendorApproved(ownerPhone: string, orgName: string) {
    await this.sendSms(
      ownerPhone,
      `Congratulations! Your storefront "${orgName}" has been approved and is now live on Muktagacha.`,
    );
  }

  // A gift order's recipient needs a DIFFERENT message than the buyer's own
  // order-confirmation SMS - from their side this is "someone sent you
  // something", not "your order was placed". Respects giftSenderAnonymous:
  // the buyer's real name is only mentioned in the SMS if they chose to
  // reveal it.
  async notifyGiftReceived(order: any) {
    const phone = order.recipient?.phone;
    if (!phone) return;
    const senderName = order.giftSenderAnonymous
      ? 'A Secret Admirer'
      : order.buyer?.fullName ?? 'Someone';
    const shopName = order.organization?.name ?? 'a Muktagacha shop';
    const messageLine = order.giftMessage ? ` They said: "${order.giftMessage}"` : '';
    await this.sendSms(
      phone,
      `${senderName} sent you a gift from ${shopName} on Muktagacha!${messageLine} It's on its way.`,
    );
  }
}
