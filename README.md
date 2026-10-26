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
  - the rest: dashboard API
- `src/lib/`: shared backend code
- `schema.sql`: database tables

## Setup

### 1. Database
Cloudflare → **Storage & Databases → D1** → create a database named `creatorgg`.
Open its **Console**, paste in `schema.sql` and run it.
Put the database ID in `wrangler.toml`.

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

## Local development

```sh
npx wrangler d1 execute DB --local --file=schema.sql
npx wrangler dev
```

Put local secrets in `.dev.vars` (not committed).

## How rates are estimated

The rate ranges and multipliers are at the top of `public/rates.js`. They're based on common industry rules of thumb:

- **YouTube:** price per 1,000 average views (integration, dedicated video, Shorts)
- **Twitch:** price per average concurrent viewer, per hour
- **TikTok:** price per 1,000 average views
- Adjusted for engagement rate, audience region and content focus
