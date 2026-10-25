# CreatorGG

**Know your worth. Land the deal.**

A free sponsorship rate calculator for gaming creators on Twitch, YouTube and TikTok.

It's a static site (plain HTML, CSS and JavaScript) with no build step, so it can be hosted for free on Cloudflare Pages.

## Run locally

Open `index.html` in a browser.

## Deploy on Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Pick this repository.
3. Framework preset: **None**. Build command: leave empty. Output directory: `/`.
4. Deploy. Every push to `main` redeploys automatically.

## How rates are estimated

The rate ranges and multipliers are at the top of `app.js`. They're based on common industry rules of thumb:

- **YouTube:** price per 1,000 average views (integration, dedicated video, Shorts)
- **Twitch:** price per average concurrent viewer, per hour
- **TikTok:** price per 1,000 average views
- Adjusted for engagement rate, audience region and content focus
