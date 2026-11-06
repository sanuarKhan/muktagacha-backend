// Single source of truth for the JWT signing secret.
//
// SECURITY: this used to be inlined as
//     process.env.JWT_SECRET ?? 'dev-secret-change-me'
// in three separate places (auth.module.ts, jwt.strategy.ts,
// chat.gateway.ts). That fallback is a critical hole in production: if
// JWT_SECRET is ever unset or typo'd on the host, the app does NOT fail —
// it silently boots and signs/verifies every token with a secret that is
// public knowledge in this repo's git history. Anyone could then mint a
// token claiming `role: 'ADMIN'` and take over the whole platform.
//
// A missing signing secret must be a hard, loud startup failure, never a
// silent downgrade. In development we still allow the convenience fallback
// so `npm run start:dev` works with no setup, but only when NODE_ENV is not
// 'production'.
const DEV_FALLBACK = 'dev-secret-change-me';

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (secret && secret.trim().length > 0) {
    // Refuse to run in production with the well-known dev value, even if it
    // was set explicitly — that is almost always a copy-paste mistake.
    if (process.env.NODE_ENV === 'production' && secret === DEV_FALLBACK) {
      throw new Error(
        'JWT_SECRET is set to the public development fallback value. ' +
          'Generate a real one with: openssl rand -hex 32',
      );
    }
    return secret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET is not set. Refusing to start in production with the ' +
        'insecure development fallback — anyone could forge an admin token. ' +
        'Generate one with: openssl rand -hex 32',
    );
  }

  return DEV_FALLBACK;
}
