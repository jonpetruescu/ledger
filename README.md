# Ledger

Your personal finance app. Plaid pulls transactions from
your banks, a Cloudflare Worker stores them in a D1 database, and a PWA on
your phone lets you file each one with a tap and track budgets.

Two layouts, switchable in Settings (the gear icon):

- **Classic ledger** — tabs for Transactions, Budget, and Plan. A paper
  register: file from the to-do stack, watch category bars, set budgets in
  a grid.
- **Envelopes** — budgets are envelope cards showing what's left in each;
  new transactions land in an Unsorted tray you empty one at a time, and
  each envelope's size is edited right inside it.

## Before you start (can do from your phone)

1. Plaid account: https://dashboard.plaid.com/signup — grab your
   **client_id** and **sandbox secret** from Keys. Don't apply for
   Production yet (stays eligible for the free Trial plan).
2. Cloudflare account: https://dash.cloudflare.com (free plan).

## First-time setup at the Mac (~20 minutes)

Install Node.js if you don't have it: https://nodejs.org (LTS).

```bash
cd ledger
npm install
npx wrangler login          # opens browser, log into Cloudflare

# Create the database, then paste its id into wrangler.toml
npx wrangler d1 create shoebox
#   -> copy the database_id it prints into wrangler.toml
#   (the D1 database keeps the historical name "shoebox"; it's internal only)

# Load the schema + default categories
npx wrangler d1 execute shoebox --remote --file=schema.sql

# Set your secrets (paste values when prompted)
npx wrangler secret put PLAID_CLIENT_ID
npx wrangler secret put PLAID_SECRET      # the SANDBOX secret for now
npx wrangler secret put APP_PASSWORD      # you pick this — it's the app login

# Ship it
npx wrangler deploy
```

## Updating an existing deploy

```bash
cd ledger
npx wrangler deploy
```

Run any new file in `migrations/` first (once each), e.g.:

```bash
npx wrangler d1 execute shoebox --remote --file=migrations/002_budgets.sql
```

If the app's URL ever changes (worker rename, custom domain): redeploy, then
tap **Settings → Update bank webhooks** in the app so Plaid pushes new
transactions to the right place.

## Try it

1. Open the URL on your phone, enter your app password.
2. Tap the gear → **Connect a bank** → pick any institution → sandbox login
   is `user_good` / `pass_good`.
3. File transactions, then set budgets under **Plan** (classic) or by
   creating envelopes (envelopes layout).
4. On iPhone: Share → **Add to Home Screen** to install it as an app.

## Local development (optional)

```bash
cp .dev.vars.example .dev.vars   # fill in your keys
npx wrangler dev                 # runs at http://localhost:8787
```

## Roadmap

- [x] Session 1: Plaid sandbox → D1 → categorize PWA
- [x] Session 2: budgets, monthly summary, two switchable layouts
      (classic ledger / envelopes), app renamed Ledger
- [ ] Session 3: web push notifications on new transactions
      (service worker handlers are already in `public/sw.js`; the Worker
      needs VAPID keys + a send on webhook — marked TODO in `src/index.js`)
- [ ] Session 4: apply for Plaid's free Trial production plan, connect
      real banks (set `PLAID_ENV = "production"` and the production secret)
- [ ] Later: dashboards, reports, native iOS app

## Notes

- Amounts follow Plaid's convention: positive = money out.
- Auth is a single shared password — fine for a personal app; we'll harden
  it before anyone else uses it.
- Categories live in the `categories` table; edit `schema.sql` or update
  the table directly to match your Tiller list.
- Budgets are per month (`budgets` table). "Copy last month" pulls forward
  the most recent month that has budgets.
