import { Injectable, Logger } from '@nestjs/common';

// Thin SMS wrapper, same integration pattern as the DMC/English Village
// project (httpSMS). Real API key wiring happens via env vars at deploy
// time; until then this logs instead of throwing, so order flow never
// breaks because notifications aren't configured yet.
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  private async sendSms(to: string, message: string) {
    const apiKey = process.env.HTTPSMS_API_KEY;
    const from = process.env.HTTPSMS_FROM;

    if (!apiKey || !from) {
      this.logger.warn(
        `SMS not sent (HTTPSMS_API_KEY/HTTPSMS_FROM not configured): to=${to} message="${message}"`,
      );
      return;
    }

    try {
      const res = await fetch('https://api.httpsms.com/v1/messages/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({ from, to, content: message }),
      });
      if (!res.ok) {
        this.logger.error(`SMS send failed: ${res.status} ${await res.text()}`);
      }
    } catch (err) {
      this.logger.error(`SMS send error: ${(err as Error).message}`);
    }
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
}
