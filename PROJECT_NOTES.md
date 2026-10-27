# CreatorGG project notes

The decisions, status and roadmap behind CreatorGG. Setup instructions are in `README.md`; this file is the "why" and the to-do list. Last updated October 2026.

## What CreatorGG is

Free media kits and sponsorship rate estimates for creators. Built for gaming creators first, works for every niche.

- **Creators** sign in with Twitch or YouTube, get a public kit at `creatorgg.com/<name>` with verified stats, rates, featured videos, audience and past brands, and share it with sponsors.
- **Money** comes from creator subscriptions now, and later from brands (directory and campaigns).
- **Growth** comes from free kits (their footer links back with the creator's referral code), the free rate calculator, and the affiliate program.

## Where things live

| What | Where |
|---|---|
| Live site | `creatorgg.com` (custom domain on the Worker), also `ratecalculator.rizzle248.workers.dev` |
| Code | GitHub `micavity/ratecalculator`, branch `main` (every push deploys automatically) |
| Hosting | Cloudflare Worker `ratecalculator` with static assets from `public/` |
| Database | Cloudflare D1 `creatorgg` (tables created and upgraded automatically, see `src/lib/migrate.js`) |
| Secrets | Cloudflare → Worker → Settings → Variables and Secrets (never in the repo or chat) |
| Payments | Stripe (live mode), webhook to `/api/stripe/webhook`, Customer Portal on with switching between Essential, Pro and Ultra |
| Sign-in | Twitch developer app (Confidential), Google Cloud project with YouTube Data API |
| Admin | `/admin`, only for account IDs in the `ADMIN_USER_IDS` secret |
| Setup check | `/api/status` shows which keys the live site can see (true/false only) |

## Decisions made, and why

### Pricing

| Plan | Price | Status |
|---|---|---|
| Free | $0 | Live |
| Essential | $4.99/month or $49.99/year | Live |
| Pro | $9.99/month or $99.99/year | Live (deal tracker); more Pro features planned |
| Ultra | $19.99/month | Planned; the only plan with AI features |

- Essential is priced low on purpose ("mess the game up"): an impulse price that undercuts other creator tools and gets people paying. Prices are easier to raise later than to win people back.
- AI features cost money per use (a few cents per pitch with Claude), so they're only in Ultra.
- Custom domains for kits were dropped from Essential (setup complexity); maybe Pro later.
- Ads: decided against for now. Never put ads on media kits. A single sponsor slot on the calculator and guides could make sense once there's traffic.

### Payments

- Switched from PayPal to **Stripe** because Checkout, the Customer Portal and promotion codes come built in.
- Stripe requests are pinned to API version `2024-06-20`, and webhooks re-fetch objects, so Stripe's account default version doesn't matter.
- A lifetime gift outranks a payment. When a plan lapses, Essential settings are kept but hidden, never deleted.
- Deleting an account cancels its Stripe subscription first.

### Referral / affiliate program

- Every creator gets a code (from their kit link, e.g. `NOVAPLAYS`) and a link (`/?ref=CODE`). Free kit footers carry the code.
- Referred creators get **20% off their first 3 months** (one Stripe coupon, plus one promotion code per referrer, created automatically).
- Referrers earn **25% of each payment for 12 months**, held **30 days** for refunds, paid by **PayPal manually** once over **$25**.
- Only brand-new accounts count; no self-referrals; the first referral link a visitor clicks wins (30-day cookie).
- These numbers live in `REFERRAL` in `src/lib/referrals.js`. If they change, update the Terms (section 11) and `/affiliates/` to match.
- Paying affiliates: `/admin` → Affiliates → send their available amount in PayPal → "Mark as paid". Suggested routine: once a month.

### Product choices

- Sign-in is Twitch or YouTube only (proves channel ownership). TikTok, Instagram, Facebook and X stats are typed in and shown as "self-reported" (platform list in `src/lib/socials.js`).
- Twitch doesn't share average viewers, so creators enter it (self-reported). Twitch followers and all YouTube stats are verified.
- Rate estimates are industry rules of thumb, adjusted by region, engagement and niche (gaming plus 15 other niches, multipliers in `public/rates.js`). They're labeled as estimates everywhere.
- YouTube engagement is the average of each recent video's own rate ((likes + comments) ÷ views), not all interactions ÷ all views, so one big video with a lower rate doesn't drag it down.
- Kit views ignore bots, link previews and the creator's own visits. We store the referring site and country, never IP addresses.
- Stats refresh daily and on a 6-hour schedule for stale accounts, because YouTube's rules don't allow keeping its data more than 30 days without refreshing.

## Status

### Done and live
- Rate calculator (`/calculator/`), homepage, pricing page, affiliates page
- Sign-in with Twitch and YouTube, profile merging when both are linked
- Media kits: verified stats, rates, featured videos with their stats, audience, brands, themes, PDF / share image / QR code
- Essential: own rates and packages, branding removal, section layout, more colors and styles, 6 videos, detailed analytics, tracked brand links, 2 kit versions
- Stripe subscriptions (monthly and yearly), Customer Portal, upgrade from pricing page
- Referral program with dashboard panel and admin affiliate overview
- Admin page: creator search, plan gifting, Founding Creator badge, site stats, affiliates and payouts
- Privacy Policy and Terms (cover YouTube data, billing and referrals), account deletion
- `robots.txt` and `sitemap.xml`
- Daily stat snapshots (saved by the cron job, `src/lib/snapshots.js`), the start of Pro's growth charts. YouTube rows are deleted after 30 days (YouTube's rules); Twitch rows and typed-in platforms are kept. Long-term YouTube history would need the YouTube Analytics API.
- "Complete your kit" checklist at the top of the dashboard Overview (hideable, disappears when done)
- **Pro plan setup:** Pro checkout, "Switch to Pro" for Essential subscribers (charges the difference now, same renewal date), gifts remembered so they come back when a paid plan ends, Pro card on `/pricing/` that switches on by itself once Pro's prices are set
- **Kit stats:** each platform card shows up to 6 stats, 3 per row (`src/lib/kit-stats.js`). Free shows the defaults (YouTube: subscribers, avg views, avg Short views, engagement, total views, uploads per month; Twitch: followers, avg viewers, avg views per past stream, streams per week, avg stream length, streaming since), topped up when one has no data. Essential and up pick any 6 per platform (`shown_stats`), including avg likes/comments, videos posted, live stream views and channel age; old `hidden_stats` choices carry over. Twitch Partner/Affiliate badge on the Twitch card. Stats not shown leave the follower total and proposals.
- **Essential extras:** the stat picker above, and the "First pitch" template (the other 4 need Pro).
- **Ultra business tools** (Deals tab, `src/lib/business.js`, `src/routes/business.js`): expense tracker (`expenses` table, yearly CSV) so the income report shows expenses and profit; tax set-aside % (badge on each paid deal, yearly total); seasonal pricing (a % per month, applied to estimated rates via `seasonalBoost` in `rateInput`, kit says "Peak season rates").
- **Monthly reports** (Reports tab, `src/lib/monthly.js`, `/api/monthly?month=YYYY-MM`): Growth (all plans), Kit and brand interest (Essential+), Business summary (Pro+), Pipeline and money health, Sponsor performance, Rate check and a brand-facing update page at `/update/<slug>/<YYYY-MM>` (Ultra). Last 12 months back to sign-up; PDF via print, CSV for summary and pipeline. YouTube growth only covers the last 30 days (snapshot rule).
- **Ultra plan:** live at $19.99/mo and $199.99/yr (prices in `wrangler.toml`). Upgrades from Pro charge the difference; downgrades credit.
- **Ultra features:** ★ Pro Creator badge on kits; "Live now on Twitch" badge (Twitch API, cached 2 minutes); auto-featured top YouTube videos and Twitch clips of the last 28 days (pinned videos first); income report with CSV export (from paid deals); Book me page at `/book/<slug>` (requests become Negotiating deals, 20 a day max, honeypot); campaign reports at `/r/<id>` with live stats (refresh on view after 6 hours and from the cron so YouTube data stays under 30 days).
- **Manager access (Ultra):** creator invites one manager (Deals only or Full access) with a one-time 7-day link. Managers sign in with **passkeys** (WebAuthn, verified in `src/lib/webauthn.js` with Web Crypto, no attestation). A manager session acts as the creator, but `getSessionUser(..., { creatorOnly: true })` blocks billing, account deletion, admin, payouts/referrals, linking accounts and team changes; Deals-only can't edit the kit or versions. Removing a manager deletes their sign-in; access pauses if the creator's Ultra ends. Passkeys only work on the domain they were made on (creatorgg.com, not workers.dev).
- **Manager plan (idea, not built):** paid plan for managers/agencies with several creators, a switcher, a public talent roster page, and requests to manage creators (creator approves).
- **Proposals (Pro):** "Proposal" on a pitched or negotiating deal (or "Create proposal") makes a page at `/p/<random id>` in the creator's kit color: their top stats, personal note, deliverables and prices (can add lines from their own rates and packages), timeline, what's included, valid-until date. The brand clicks **Accept** (name and email) or **Request changes** (a note). Accepting sets the deal to Agreed with the proposal's total and deliverables, or creates the deal if there wasn't one; it's then one click to invoice. Updating a proposal after changes reopens it at the same link. Views are counted (not the owner's, not bots). No email alerts yet: creators see responses on their dashboard.
- **Pitch templates (Pro):** Deals tab; 5 emails (first pitch, follow-up, rate reply, campaign recap, reconnect) filled with the creator's top stats, topics, rates and kit link (the brand's tracked link if one exists). Copy, or open in the email app. All in the browser.
- **Invoices (Pro):** "Invoice" on a deal (or "Create invoice") makes a numbered invoice prefilled from the deal: creator's details and payment instructions (saved for next time), bill-to, line items, optional tax, notes. Shared at `/i/<random id>` (always light, prints to PDF), so brands can open the link. Paying an invoice marks its deal paid and the other way round. Sent links keep working if Pro lapses; deleting the account deletes them.
- **Game box art:** games listed on a kit show Twitch box art (matched on save, suggestions while typing, topics stay plain tags; non-game Twitch categories like Music are left out). Art for older profiles is added by the cron job.
- **Instagram, Facebook and X** (self-reported): stats on the dashboard, kit cards, rate estimates (Reels, posts, Stories, videos, X posts) and the calculator
- **Deal tracker (Pro):** Deals tab with stages (Pitched → Negotiating → Agreed → Delivered → Paid, or Lost), amounts in 15 currencies, deliverables, content and payment due dates with overdue alerts, totals (earned this month, owed, pipeline), brand autofill from earlier deals and the kit's brand list, brand logos, and "Start a deal" from tracked links (deals show when the brand opens the kit). Deals are kept, hidden, if Pro lapses, and move over when profiles merge.

### Waiting on / to do outside the code
- [ ] **Google verification** of the `youtube.readonly` scope (submitted). Until approved, YouTube sign-in shows "Google hasn't verified this app" and is capped at 100 users. **Don't launch widely until this is approved.**
- [ ] **UK broadband filters** block the new domain for some people (a UK friend couldn't open `creatorgg.com` but could open the workers.dev address). Submit `creatorgg.com` for categorization at Cisco Talos, Fortinet and Palo Alto Networks, and report it to Sky, BT, Virgin Media and TalkTalk. Usually clears up as the domain ages.
- [ ] Turn on **Always Use HTTPS** (Cloudflare → creatorgg.com → SSL/TLS → Edge Certificates).
- [ ] Add **`www.creatorgg.com`** as a second custom domain on the Worker.
- [ ] Submit `https://creatorgg.com/sitemap.xml` in **Google Search Console** → Sitemaps.
- [ ] Make sure **support@creatorgg.com** forwards to a real inbox (Cloudflare Email Routing). The legal pages point to it.
- [ ] Decide on **sales tax** (Stripe Tax, or check with an accountant).
- [ ] Have a lawyer look over the Terms and Privacy Policy before scaling up. Tell Claude the country and state to add a governing-law section.
- [ ] Soft launch: gift creator friends Ultra for life on `/admin`, collect feedback and example kits.

## Roadmap (agreed order, open to change)

1. **Before the public launch:** example kits from friends; maybe email alerts ("Razer opened your kit", welcome email; needs an email-sending service); daily stat snapshots (done).
2. **TikTok verified stats** (TikTok Login Kit; needs TikTok app approval, so start early). Then maybe Instagram (Meta API, needs approval) and Kick.
3. **Pro ($9.99):** ~~deal tracker~~ (done), ~~invoices~~ (done), ~~pitch templates~~ (done), ~~proposals~~ (done), growth charts, sponsor leads (from creators' brand lists plus a curated list).
4. **Ultra ($19.99):** AI pitch writer, AI bio and kit copy, automatic sponsor detection.
5. **Brand side (the bigger money later):** add a "list me in the brand directory" opt-in early, then brand search ($49–299/mo) and campaigns (indie game devs first; fee per campaign or a cut of deals).
6. **Affiliate extras:** per-creator commission rates for ambassadors, custom codes.
7. **Growth:** guides for search traffic ("what to charge for a sponsored stream", pitch templates).

## Ultra ideas shortlist (liked, not built yet)

Working with brands (pick from):
- **Content approval:** brand approves or requests changes on a draft (script, video, thumbnail), like proposals.
- **Deal room:** one private page per deal for creator and brand with proposal, brief, deadlines, approvals, invoice and report.
- **Brief inbox:** brands upload logos, images and talking points to a deal (Cloudflare R2, free up to 10 GB).
- **Standard terms library:** saved clauses (usage rights, exclusivity, revisions, payment terms) to attach to proposals.

## Notes for whoever works on this next

- Read `README.md` for setup, then this file.
- Database changes: add a new step to the end of `MIGRATIONS` in `src/lib/migrate.js`; never edit old steps.
- Plan limits live in `src/lib/plans.js`. Features are checked on the server, not just hidden in the page.
- New top-level pages need their path added to `RESERVED_SLUGS` in `src/lib/users.js`, so nobody can claim it as a kit link.
- Test locally with `npx wrangler dev`. For payments, point `STRIPE_API_BASE` in `.dev.vars` at a mock Stripe server rather than the real one.
