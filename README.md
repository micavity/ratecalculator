# CreatorGG

**Know your worth. Land the deal.**

Free sponsorship rate calculator and media kits for creators on Twitch, YouTube, TikTok, Instagram, Facebook and X.

Runs entirely on Cloudflare: a Worker with static assets, plus D1 for the database.

See `PROJECT_NOTES.md` for decisions, status and the roadmap.

## Project layout

- `public/`: static pages: homepage, `calculator/`, `pricing/`, `affiliates/`, `login/`, `dashboard/`, `privacy/`, `terms/`
- `public/rates.js`: rate formulas, shared by the calculator and media kits
- `src/index.js`: the Worker. Static files in `public/` are served first; everything else is routed here.
- `src/routes/`: backend routes
  - `kit.js`: public media kits at `/<name>`
  - `auth-start.js`, `auth-callback.js`: Twitch and YouTube sign-in
  - `admin.js`: admin page and API
  - `deals.js`: Pro deal tracker API
  - `invoices.js`: Pro invoices API, and the shareable invoice page at `/i/<id>`
  - `proposals.js`: Pro proposals API, the proposal page at `/p/<id>`, and the brand's accept / request-changes actions
  - `games.js`: game suggestions with Twitch box art (`src/lib/games.js` matches listed games on save)
  - the rest: dashboard API (profile, analytics, tracked links, kit versions)
- `src/lib/`: shared backend code
- `src/lib/migrate.js`: database tables. New migrations run automatically on the first request after a deploy.

## Setup

### 1. Database
Cloudflare → **Storage & Databases → D1** → create a database named `creatorgg`.
Put the database ID in `wrangler.toml`. Tables are created automatically.

### 2. Twitch sign-in
[dev.twitch.tv/console](https://dev.twitch.tv/console) → **Register Your Application**
- OAuth Redirect URL: `https://<your-site>/auth/twitch/callback`
- Category: Website Integration · Client type: Confidential

### 3. YouTube sign-in
[console.cloud.google.com](https://console.cloud.google.com):
1. Create a project and enable **YouTube Data API v3**.
2. **OAuth consent screen**: External, add the `youtube.readonly` scope, add yourself as a test user.
3. **Credentials → OAuth client ID** (Web application), redirect URI `https://<your-site>/auth/youtube/callback`.
4. **Credentials → API key**, restricted to YouTube Data API v3.

### 4. Secrets
Cloudflare Worker → **Settings → Variables and Secrets**, add as encrypted secrets:

| Name | From |
|---|---|
| `TWITCH_CLIENT_ID` | Twitch app |
| `TWITCH_CLIENT_SECRET` | Twitch app |
| `GOOGLE_CLIENT_ID` | Google OAuth client |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client |
| `YOUTUBE_API_KEY` | Google API key |

Redeploy after adding them. Check `/api/status` to confirm the site can see them.

### 5. Admin access
Add a secret `ADMIN_USER_IDS` with your CreatorGG account ID (shown at the bottom of the dashboard's Overview tab). Separate several IDs with commas. Admins can open `/admin` to search creators, gift plans and see site stats; everyone else gets a 404.

### 6. Payments (Stripe)
1. Create an Essential product with two recurring prices (monthly and yearly) and put their IDs in `wrangler.toml` under `[vars]` as `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY`. For Pro, do the same with `STRIPE_PRICE_PRO_MONTHLY` and `STRIPE_PRICE_PRO_YEARLY`; Pro shows as "Coming soon" until both are set.
2. Add the secret key as a secret named `STRIPE_SECRET_KEY`.
3. Add a webhook endpoint at `https://<your-site>/api/stripe/webhook` for these events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`. Add its signing secret as `STRIPE_WEBHOOK_SECRET`.
4. Turn on the Customer Portal (Settings → Billing → Customer portal) with cancel, update payment method, invoice history and switching between plans (add both products and all four prices).

All Stripe requests use API version `2024-06-20`, and webhooks re-fetch objects from Stripe, so the account's default API version doesn't matter.

## Referrals

Every creator gets a referral code (from their kit link) and a link (`/?ref=CODE`), and free kits' footer links carry it. Referred creators get 20% off their first 3 months (a Stripe coupon plus one promotion code per referrer, created automatically). Referrers earn 25% of each payment for 12 months, held 30 days, paid manually via PayPal from `/admin` once over $25. Settings are in `REFERRAL` in `src/lib/referrals.js`.

## Plans

| Plan | Price | Includes |
|---|---|---|
| Free | $0 | Media kit, verified stats, estimated rates, 3 featured videos, sharing tools, view counts |
| Essential | $4.99/mo or $49.99/yr | Own rates and packages, no CreatorGG branding, section layout, more colors and kit styles, 6 featured videos, detailed analytics, tracked brand links, 2 extra kit versions |
| Pro | $9.99/mo or $99.99/yr | Everything in Essential, plus the deal tracker (more Pro features planned) |
| Ultra | later | |

Plans live on the `users` table (`plan`, `plan_source` = `paid` or `gift`, `plan_expires`, null = never). Limits are in `src/lib/plans.js`. Features are checked on the server; when a plan lapses, Essential settings are kept but hidden. Paid plans come from Stripe; gifted plans are set from `/admin` and also remembered in `gift_plan` / `gift_expires`, so a gift comes back when a paid plan ends. A gift that's at least as good as the paid plan and lasts at least as long takes priority over a payment. Creators who already pay move from Essential to Pro with "Switch to Pro" (`/api/billing/change`), which charges the difference right away.

## Local development

```sh
npx wrangler dev
```

Put local secrets in `.dev.vars` (not committed). For testing without real services, `STRIPE_API_BASE`, `TWITCH_API_BASE` and `TWITCH_TOKEN_URL` can point at local test servers.

## How rates are estimated

The rate ranges and multipliers are at the top of `public/rates.js`. They're based on common industry rules of thumb:

- **YouTube:** price per 1,000 average views (integration, dedicated video, Shorts)
- **Twitch:** price per average concurrent viewer, per hour
- **TikTok:** price per 1,000 average views
- **Instagram:** Reels per 1,000 average views; feed posts and Stories per 1,000 followers
- **Facebook:** videos per 1,000 average views; posts per 1,000 followers
- **X:** per 1,000 average views per post (or per 1,000 followers if views aren't given)
- Adjusted for engagement rate, audience region and niche (gaming plus finance, beauty, lifestyle and more)
