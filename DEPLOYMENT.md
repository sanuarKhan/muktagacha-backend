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
