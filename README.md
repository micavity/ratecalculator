# CreatorGG

**Know your worth. Land the deal.**

Free sponsorship rate calculator and media kits for gaming creators on Twitch, YouTube and TikTok.

Runs entirely on Cloudflare: a Worker with static assets, plus D1 for the database.

## Project layout

- `public/`: static pages (rate calculator, login, dashboard)
- `public/rates.js`: rate formulas, shared by the calculator and media kits
- `src/index.js`: the Worker. Static files in `public/` are served first; everything else is routed here.
- `src/routes/`: backend routes
  - `kit.js`: public media kits at `/<name>`
  - `auth-start.js`, `auth-callback.js`: Twitch and YouTube sign-in
  - `admin.js`: admin page and API
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

## Plans

| Plan | Price | Includes |
|---|---|---|
| Free | $0 | Media kit, verified stats, estimated rates, 3 featured videos, sharing tools, view counts |
| Essential | $4.99/mo or $49.99/yr | Own rates and packages, no CreatorGG branding, section layout, more colors and kit styles, 6 featured videos, detailed analytics, tracked brand links, 2 extra kit versions |
| Pro / Ultra | later | |

Plans live on the `users` table (`plan`, `plan_source` = `paid` or `gift`, `plan_expires`, null = never). Limits are in `src/lib/plans.js`. Features are checked on the server; when a plan lapses, Essential settings are kept but hidden. Payments (PayPal) aren't connected yet, so plans can only be gifted from `/admin`.

## Local development

```sh
npx wrangler dev
```

Put local secrets in `.dev.vars` (not committed).

## How rates are estimated

The rate ranges and multipliers are at the top of `public/rates.js`. They're based on common industry rules of thumb:

- **YouTube:** price per 1,000 average views (integration, dedicated video, Shorts)
- **Twitch:** price per average concurrent viewer, per hour
- **TikTok:** price per 1,000 average views
- Adjusted for engagement rate, audience region and niche (gaming plus finance, beauty, lifestyle and more)
