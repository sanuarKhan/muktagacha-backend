/**
 * The ONLY organization fields that may be sent to the public or to buyers.
 *
 * Why this exists: public endpoints (product browse, shop list, a buyer's
 * order history) used `organization: true`, which serialises EVERY column.
 * That exposed, to anyone on the internet:
 *   - cloudinaryApiKey / cloudinaryApiSecretEnc   (vendor's image hosting)
 *   - skodePayApiKeyEnc                            (vendor's payment gateway)
 *   - smsGatewayLogin / smsGatewayPassword         (vendor's SMS phone)
 *   - tradeLicenseUrl / nidUrl                     (national ID photos)
 *   - ownerUserId, verificationNote
 * The secrets are encrypted at rest, but ciphertext plus API key IDs must
 * never be public, and NID photos are personal data.
 *
 * Use `select: PUBLIC_ORG_SELECT` (or `organization: { select: ... }`) on any
 * response that leaves the vendor's own dashboard.
 *
 * bKash/Nagad numbers ARE included: buyers need them at checkout to pay the
 * shop directly, and the shop deliberately publishes them for that purpose.
 */
export const PUBLIC_ORG_SELECT = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  bannerUrl: true,
  tagline: true,
  description: true,
  vertical: true,
  area: true,
  ward: true,
  latitude: true,
  longitude: true,
  deliveryRadiusKm: true,
  approvalStatus: true,
  verificationStatus: true,
  avgRating: true,
  reviewCount: true,
  bkashNumber: true,
  nagadNumber: true,
  skodePayEnabled: true,
  facebookUrl: true,
  whatsappNumber: true,
  createdAt: true,
} as const;

/**
 * PUBLIC_ORG_SELECT plus ownerUserId. For server-side permission checks
 * ("is this the shop owner?") on orders, bookings and chats, where the
 * record is returned to a party who already knows which shop it is.
 * ownerUserId is an opaque UUID, not a credential. Every secret column
 * stays excluded.
 */
export const ORG_WITH_OWNER_SELECT = {
  ...PUBLIC_ORG_SELECT,
  ownerUserId: true,
} as const;
