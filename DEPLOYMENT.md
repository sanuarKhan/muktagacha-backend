# Muktagacha — Deployment Checklist

## 1. Database — Supabase (free tier)

1. Create a new Supabase project at supabase.com (name it e.g. "muktagacha-prod")
2. Go to Project Settings -> Database -> Connection string -> copy the "Transaction pooler" URI (port 6543, not the direct 5432 one — serverless hosts need the pooler)
3. Save this as DATABASE_URL (used below)
4. From your local machine, with DATABASE_URL pointed at the new Supabase project, run:
   - cd muktagacha-backend
   - Create a real .env with DATABASE_URL set to the Supabase pooler URL
   - Run: node node_modules/prisma/build/index.js db push
   - This creates all tables (users, organizations, listings, orders, order_items) in the new database
5. Optionally seed an initial ADMIN user directly via Supabase's SQL editor (same pattern used in local testing) so you have a working admin login on day one

## 2. Backend — Railway (free tier)

1. Create a new Railway project, connect it to the `sanuarKhan/muktagacha-backend` GitHub repo
2. Railway auto-detects Node — set these environment variables in Railway's dashboard:
   - DATABASE_URL = (the Supabase pooler URL from step 1)
   - JWT_SECRET = a long random string (generate with: openssl rand -hex 32)
   - CORS_ORIGIN = https://your-frontend-domain.vercel.app (set this AFTER you deploy the frontend in step 3 and know its real URL; comma-separate multiple origins if needed)
   - PORT = Railway sets this automatically, no need to set manually
   - HTTPSMS_API_KEY = (optional, for real SMS — your httpSMS account's API key)
   - HTTPSMS_FROM = (optional, the phone number registered with httpSMS)
3. Build command: npm run build
4. Start command: npm run start:prod (or node dist/main.js if start:prod isn't defined — check package.json scripts)
5. After first deploy succeeds, note the Railway-provided URL (e.g. muktagacha-backend-production.up.railway.app) — this is your API_URL for the frontend

## 3. Frontend — Vercel (free tier)

1. Import the `sanuarKhan/muktagacha-web` GitHub repo into Vercel
2. Framework preset: Next.js (auto-detected)
3. Set this environment variable in Vercel's dashboard:
   - NEXT_PUBLIC_API_URL = https://muktagacha-backend-production.up.railway.app (the Railway URL from step 2)
4. Deploy
5. After deploy succeeds, note the Vercel URL (e.g. muktagacha-web.vercel.app)
6. Go back to Railway and set CORS_ORIGIN to this exact Vercel URL (step 2.2) — redeploy the backend so the new CORS setting takes effect

## 4. Final verification checklist (do these in order after both are deployed)

1. Open the Vercel URL — homepage should load (may show "no listings yet" since the new Supabase DB is empty)
2. Register a new admin-capable user is NOT possible via the public form (by design — ADMIN is blocked from self-registration). Use the Supabase SQL editor to manually insert one admin row, same way it was done in local testing, OR temporarily allow ADMIN in the register DTO, create one admin, then revert.
3. Register a real VENDOR account (e.g. your brother's clothing business) through the real signup form
4. Log in as admin, go to /admin, approve that vendor
5. Log in as the vendor, go to /vendor, create a storefront, add 1-2 real products
6. Log out, browse the homepage as a visitor — confirm the real products show up
7. Register a BUYER account, add a product to cart, check out with Cash on Delivery
8. Log back in as the vendor, confirm the order appears in their dashboard and status can be updated
9. Log back in as the buyer, confirm the order status change is reflected on their Orders page

## 5. Known gaps to be aware of before real customers use this

- SMS notifications are built but need HTTPSMS_API_KEY / HTTPSMS_FROM set to actually send (same httpSMS account already used for the DMC/English Village project can be reused, or a separate one if you want these kept financially/organizationally separate)
- No password reset flow yet (Phase 1 scope was login/register only — add this before wide public use)
- No payment verification for bKash/Nagad yet — Phase 1 is "enter payment method, vendor collects manually" by design, matching the trust-first sequencing from the plan
- No rate limiting on the API yet — fine for an initial small-town launch, worth adding before any wider marketing push

## 6. Chat system (buyer↔vendor messaging, shop Q&A, community groups)

Added: private 1:1 buyer-vendor conversations, a public per-shop Q&A board, and
user-created community groups with Discord-style topics — all real-time via
Socket.IO, backed by Postgres (not an in-memory/ephemeral store).

**Why Socket.IO + Railway, not Vercel serverless functions:** WebSocket
connections need a long-lived process — a serverless function (Vercel) can't
hold one open. Railway already runs the backend as a persistent Node process,
so this was free to add with zero new infrastructure or hosting cost. If the
backend ever moves to a serverless host, the real-time layer would need to
move to a managed service (Pusher, Ably, or Supabase Realtime) instead — flag
this if that migration is ever discussed.

**Cost at current scale**: $0 extra. Same Railway dyno, same Supabase
Postgres, no new paid service. Socket.IO's own Redis-adapter scaling (needed
only once you run multiple backend instances behind a load balancer) is not
set up — single Railway instance can comfortably hold several thousand
concurrent idle sockets before that becomes necessary.

**Known shortcuts taken (documented, not hidden) — things to revisit before
heavy usage:**
- No message pagination yet — a conversation's full history loads in one
  request. Fine for the expected volume of a small-town buyer-vendor chat,
  but would need a `cursor`/`limit` param before any thread grows into the
  thousands of messages.
- No image/file attachments in chat — text only for now (same trust-first,
  smallest-working-version sequencing as the rest of Phase 1).
- No push notifications when the browser tab is closed — a message only
  shows up in the floating widget's unread badge while the site is open.
  Real push (web push API, or an SMS fallback via the existing httpSMS
  integration) is a natural Phase 2 add once there's real usage to justify it.
- Group moderation is minimal (owner can't remove members or delete posts
  yet) — acceptable for an initial trust-based local-community launch, not
  acceptable once the community grows past people who know each other.
- The public Shop Q&A board has no spam/abuse controls (rate limiting,
  reporting) — same reasoning: fine for a small early user base, a real gap
  once the shop list grows.

## 7. Answer voting + customer-to-customer messenger

- **Reddit-style voting**: each Q&A answer has a live net score (upvotes
  minus downvotes); answers sort best-score-first instead of oldest-first.
- **Customer-to-customer messenger**: buyers can message each other
  directly (not just a shop), discoverable via a "Message" button on
  Community posts. Either side can start this freely — unlike the
  buyer-vendor rule, there's no "only one side can initiate" restriction
  here, since it's peer discussion, not a sales channel.
- No new infrastructure or cost for either — reuses the same Postgres
  tables and Socket.IO gateway as the rest of the chat system.

## 8. Anonymous posting + gift orders

- **Anonymous posting**: Q&A questions/answers and community posts can be
  marked anonymous by the author at posting time. Real identity is always
  kept in the database (never actually anonymous at the data layer - a
  vendor/admin with DB access could still trace abuse back to a real
  account), only hidden from other users in the API response. This is the
  correct and standard tradeoff for a real platform (compare: Reddit
  "throwaway" accounts are still traceable by Reddit itself).
- **Gift orders**: a buyer can send an order to a different registered
  user, found via name/phone search. Sender chooses per-gift whether to
  reveal their identity or appear as "A Secret Admirer" to the recipient
  - enforced server-side in both the gifts-received list and the SMS
    notification, not just hidden in the UI.
- Known gap: the recipient is NOT verified as a real, reachable phone
  number before the gift ships - if someone registers with a fake/wrong
  phone, the gift notification simply won't reach them (same limitation
  as the rest of the SMS system, not new to gifting).
- No new infrastructure or cost for either feature.

## 9. Chat privacy (name masking) + maps directions fix

- Private 1:1 chats (buyer<->vendor and the customer<->customer
  messenger) now mask display names - first and last letter shown,
  everything between replaced with asterisks (e.g. "Karim Ahmed" ->
  "K*********d"). Phone numbers were never exposed in chat to begin with.
  Masking happens server-side, not just hidden in the UI.
- "Get directions" links now point to Google Maps' keyless
  destination-only URL instead of the full openstreetmap.org website -
  the embedded maps (shop location, delivery pin) always used free,
  keyless OpenStreetMap tiles; only the external directions LINK was
  routing through openstreetmap.org's page chrome, which has login/signup
  buttons that looked like a forced account requirement even though none
  was actually needed.

## 10. Vendor trust verification + fraud detection

- **Vendor verification**: a vendor can upload a trade license and/or NID
  photo to earn a public "Verified" badge - at least one document is
  mandatory, both accepted for a stronger review. Separate from the
  existing approvalStatus (a shop can be live and selling while still
  Unverified - verification is opt-in trust-building, not a launch gate).
  Admin reviews submissions in a dedicated queue and approves/rejects.
- **Fraud detection**: rule-based, admin-review-only - NEVER auto-blocks
  an order. Four rules: rapid repeat orders to the same vendor, high
  Cash-on-Delivery cancellation rate, a payment transaction ID reused
  across orders, and a brand-new account placing an unusually large
  order. Every flag lands in an admin review queue; the order itself is
  never held, delayed, or cancelled automatically - a human always makes
  the final call.
- Known gap: the ৳3,000 "high value" threshold and the 3-strikes/15-minute
  rapid-order window are reasonable starting guesses, not tuned against
  real Muktagacha order data (there isn't enough yet) - worth revisiting
  once real order volume exists.
- No new infrastructure or cost - reuses existing Cloudinary uploads and
  Postgres.
