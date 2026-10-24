import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { SecretCryptoService } from '../crypto/secret-crypto.service.js';

export interface CloudinaryCredentials {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  isVendorOwn: boolean;
}

export interface SignedUpload {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
}

// Signed direct-to-Cloudinary upload, per-vendor credentials with a
// shared fallback. The API secret NEVER leaves this service - we only
// ever hand the browser a short-lived signature it can use to upload
// directly to Cloudinary, matching Cloudinary's own recommended
// "signed upload" pattern (see cloudinary.com/documentation/signatures).
@Injectable()
export class CloudinaryService {
  constructor(
    private prisma: PrismaService,
    private secretCrypto: SecretCryptoService,
  ) {}

  async getCredentialsForOrg(organizationId: string): Promise<CloudinaryCredentials> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        cloudinaryCloudName: true,
        cloudinaryApiKey: true,
        cloudinaryApiSecretEnc: true,
      },
    });

    if (
      org?.cloudinaryCloudName &&
      org?.cloudinaryApiKey &&
      org?.cloudinaryApiSecretEnc
    ) {
      return {
        cloudName: org.cloudinaryCloudName,
        apiKey: org.cloudinaryApiKey,
        apiSecret: this.secretCrypto.decrypt(org.cloudinaryApiSecretEnc),
        isVendorOwn: true,
      };
    }

    // Fall back to the shared platform account.
    const cloudName = process.env.CLOUDINARY_FALLBACK_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_FALLBACK_API_KEY;
    const apiSecret = process.env.CLOUDINARY_FALLBACK_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) {
      throw new InternalServerErrorException(
        'Image upload is not configured: connect your own Cloudinary account in Shop Settings, ' +
          'or ask the platform admin to configure a shared fallback.',
      );
    }
    return { cloudName, apiKey, apiSecret, isVendorOwn: false };
  }

  async createSignedUpload(organizationId: string): Promise<SignedUpload> {
    const creds = await this.getCredentialsForOrg(organizationId);
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = `muktagacha/${organizationId}`;

    // Cloudinary's signature recipe: sort all params to be signed
    // alphabetically, join as key=value&key=value, append the API
    // secret, SHA-1 hash the whole string. Only folder+timestamp are
    // signed here (the minimal set); any extra upload param the client
    // adds that ISN'T in this signed set will be rejected by Cloudinary,
    // which is the point - it can't inject arbitrary unsigned params.
    const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;
    const signature = createHash('sha1')
      .update(paramsToSign + creds.apiSecret)
      .digest('hex');

    return {
      cloudName: creds.cloudName,
      apiKey: creds.apiKey,
      timestamp,
      signature,
      folder,
    };
  }

  async saveCredentials(
    organizationId: string,
    cloudName: string,
    apiKey: string,
    apiSecret: string,
  ) {
    const encrypted = this.secretCrypto.encrypt(apiSecret);
    return this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        cloudinaryCloudName: cloudName,
        cloudinaryApiKey: apiKey,
        cloudinaryApiSecretEnc: encrypted,
      },
    });
  }

  async removeCredentials(organizationId: string) {
    return this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        cloudinaryCloudName: null,
        cloudinaryApiKey: null,
        cloudinaryApiSecretEnc: null,
      },
    });
  }
}
