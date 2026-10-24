import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

// AES-256-GCM encryption for vendor Cloudinary API secrets at rest.
// Format stored in DB: base64(iv):base64(authTag):base64(ciphertext)
// GCM mode gives us both confidentiality AND tamper detection (the
// authTag check fails loudly if the ciphertext was altered) - important
// since a corrupted/tampered secret here means silent upload failures
// for a vendor otherwise.
@Injectable()
export class SecretCryptoService implements OnModuleInit {
  private key!: Buffer;

  onModuleInit() {
    const raw = process.env.SECRET_ENCRYPTION_KEY;
    if (!raw) {
      throw new Error(
        'SECRET_ENCRYPTION_KEY is not set. Generate one with: ' +
          `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
      );
    }
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) {
      throw new Error(
        `SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes, got ${key.length}`,
      );
    }
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12); // 96-bit IV, standard for GCM
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(stored: string): string {
    const [ivB64, authTagB64, ciphertextB64] = stored.split(':');
    if (!ivB64 || !authTagB64 || !ciphertextB64) {
      throw new Error('Malformed encrypted secret (expected iv:authTag:ciphertext)');
    }
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const ciphertext = Buffer.from(ciphertextB64, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
