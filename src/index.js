// CreatorGG Worker. Static pages in public/ are served automatically;
// anything that isn't a static file comes here.
import * as me from './routes/me.js';
import * as profile from './routes/profile.js';
import * as refresh from './routes/refresh.js';
import * as logout from './routes/logout.js';
import * as disconnect from './routes/disconnect.js';
import * as authStart from './routes/auth-start.js';
import * as authCallback from './routes/auth-callback.js';
import * as kit from './routes/kit.js';
import * as status from './routes/status.js';
import * as session from './routes/session.js';
import * as account from './routes/account.js';
import * as analytics from './routes/analytics.js';
import * as links from './routes/links.js';
import * as versions from './routes/versions.js';
import * as admin from './routes/admin.js';
import * as billing from './routes/billing.js';
import * as referrals from './routes/referrals.js';
import * as deals from './routes/deals.js';
import * as plans from './routes/plans.js';
import * as games from './routes/games.js';
import * as invoices from './routes/invoices.js';
import * as proposals from './routes/proposals.js';
import * as booking from './routes/booking.js';
import * as reports from './routes/reports.js';
import * as team from './routes/team.js';
import * as monthly from './routes/monthly.js';
import * as business from './routes/business.js';
import * as reviews from './routes/reviews.js';
import { ensureSchema } from './lib/migrate.js';
import { refreshStaleUsers } from './lib/users.js';
import { pruneOldEvents } from './lib/analytics.js';
import { takeSnapshots } from './lib/snapshots.js';
import { backfillGameArt } from './lib/games.js';
import { refreshStaleReports } from './lib/reports.js';

// [method, path pattern, handler]. ":name" matches one path segment.
const ROUTES = [
  ['GET', '/api/status', status.onRequestGet],
  ['GET', '/api/session', session.onRequestGet],
  ['GET', '/api/me', me.onRequestGet],
  ['PUT', '/api/profile', profile.onRequestPut],
  ['DELETE', '/api/account', account.onRequestDelete],
  ['GET', '/api/analytics', analytics.onRequestGet],
  ['POST', '/api/links', links.onRequestPost],
  ['DELETE', '/api/links/:id', links.onRequestDelete],
  ['POST', '/api/versions', versions.onRequestPost],
  ['PUT', '/api/versions/:id', versions.onRequestPut],
  ['DELETE', '/api/versions/:id', versions.onRequestDelete],
  ['POST', '/api/billing/checkout', billing.checkout],
  ['POST', '/api/billing/portal', billing.portal],
  ['POST', '/api/billing/change', billing.changePlan],
  ['GET', '/api/deals', deals.onRequestGet],
  ['POST', '/api/deals', deals.onRequestPost],
  ['PUT', '/api/deals/:id', deals.onRequestPut],
  ['DELETE', '/api/deals/:id', deals.onRequestDelete],
  ['GET', '/api/plans', plans.onRequestGet],
  ['GET', '/api/games', games.onRequestGet],
  ['GET', '/api/invoices', invoices.onRequestGet],
  ['POST', '/api/invoices', invoices.onRequestPost],
  ['PUT', '/api/invoices/:id', invoices.onRequestPut],
  ['DELETE', '/api/invoices/:id', invoices.onRequestDelete],
  ['PUT', '/api/invoice-settings', invoices.settingsPut],
  ['GET', '/api/proposals', proposals.onRequestGet],
  ['POST', '/api/proposals', proposals.onRequestPost],
  ['PUT', '/api/proposals/:id', proposals.onRequestPut],
  ['DELETE', '/api/proposals/:id', proposals.onRequestDelete],
  ['POST', '/p/:id/accept', proposals.accept],
  ['POST', '/p/:id/changes', proposals.requestChanges],
  ['GET', '/api/booking', booking.onRequestGet],
  ['PUT', '/api/booking', booking.settingsPut],
  ['POST', '/api/booking/slots', booking.slotPost],
  ['PUT', '/api/booking/slots/:id', booking.slotPut],
  ['DELETE', '/api/booking/slots/:id', booking.slotDelete],
  ['POST', '/book/:slug/request', booking.requestPost],
  ['GET', '/api/reports', reports.onRequestGet],
  ['POST', '/api/reports', reports.onRequestPost],
  ['PUT', '/api/reports/:id', reports.onRequestPut],
  ['DELETE', '/api/reports/:id', reports.onRequestDelete],
  ['GET', '/api/team', team.onRequestGet],
  ['POST', '/api/team/invite', team.invitePost],
  ['DELETE', '/api/team/invite', team.inviteDelete],
  ['PUT', '/api/team/manager', team.managerPut],
  ['DELETE', '/api/team/manager', team.managerDelete],
  ['POST', '/api/passkeys/register/options', team.registerOptions],
  ['POST', '/api/passkeys/register/verify', team.registerVerify],
  ['POST', '/api/passkeys/login/options', team.loginOptions],
  ['POST', '/api/passkeys/login/verify', team.loginVerify],
  ['GET', '/team/join/:token', team.joinPage],
  ['GET', '/api/monthly', monthly.onRequestGet],
  ['GET', '/api/expenses', business.expensesGet],
  ['POST', '/api/expenses', business.expensePost],
  ['DELETE', '/api/expenses/:id', business.expenseDelete],
  ['PUT', '/api/business', business.settingsPut],
  ['POST', '/api/reviews', reviews.onRequestPost],
  ['POST', '/api/reviews/later', reviews.later],
  ['POST', '/api/reviews/never', reviews.never],
  ['GET', '/api/admin/reviews', admin.reviews],
  ['POST', '/api/admin/reviews/:id/approve', admin.approveReview],
  ['GET', '/update/:slug/:month', monthly.updatePage],
  ['POST', '/api/stripe/webhook', billing.webhook],
  ['GET', '/api/referrals', referrals.onRequestGet],
  ['PUT', '/api/referrals', referrals.onRequestPut],
  ['POST', '/api/refresh', refresh.onRequestPost],
  ['POST', '/api/logout', logout.onRequestPost],
  ['DELETE', '/api/connections/:provider', disconnect.onRequestDelete],
  ['GET', '/auth/:provider', authStart.onRequestGet],
  ['GET', '/auth/:provider/callback', authCallback.onRequestGet],
  ['GET', '/api/admin/stats', admin.stats],
  ['GET', '/api/admin/users', admin.users],
  ['POST', '/api/admin/users/:id/plan', admin.setPlan],
  ['POST', '/api/admin/users/:id/founding', admin.setFounding],
  ['GET', '/api/admin/affiliates', admin.affiliates],
  ['GET', '/api/admin/affiliates/:id', admin.affiliateDetail],
  ['POST', '/api/admin/payouts/:id/paid', admin.markPaid],
  ['GET', '/admin', admin.page],
  ['GET', '/i/:id', invoices.page],
  ['GET', '/p/:id', proposals.page],
  ['GET', '/book/:slug', booking.page],
  ['GET', '/r/:id', reports.page],
  ['GET', '/:slug', kit.onRequestGet],
  ['GET', '/:slug/:version', kit.onRequestGet],
];

function match(pattern, path) {
  const want = pattern.split('/');
  const got = path.replace(/\/$/, '').split('/');
  if (want.length !== got.length) return null;
  const params = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(':')) {
      if (!got[i]) return null;
      params[want[i].slice(1)] = decodeURIComponent(got[i]);
    } else if (want[i] !== got[i]) {
      return null;
    }
  }
  return params;
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    const next = () => env.ASSETS.fetch(request);

    for (const [method, pattern, handler] of ROUTES) {
      const params = match(pattern, path);
      if (!params) continue;
      if (request.method !== method && !(method === 'GET' && request.method === 'HEAD')) continue;
      try {
        await ensureSchema(env);
        return await handler({ request, env, params, next, waitUntil: (p) => ctx.waitUntil(p) });
      } catch (err) {
        console.error(`${request.method} ${path} failed:`, err);
        return new Response('Something went wrong', { status: 500 });
      }
    }
    return next();
  },

  // Cron trigger (see wrangler.toml): keeps stored platform stats fresh,
  // since YouTube's rules don't allow keeping data older than 30 days
  async scheduled(event, env, ctx) {
    await ensureSchema(env);
    ctx.waitUntil(refreshStaleUsers(env));
    ctx.waitUntil(pruneOldEvents(env));
    ctx.waitUntil(takeSnapshots(env).catch((err) => console.error('Snapshots failed:', err.message)));
    ctx.waitUntil(backfillGameArt(env).catch((err) => console.error('Game art backfill failed:', err.message)));
    ctx.waitUntil(refreshStaleReports(env).catch((err) => console.error('Report refresh failed:', err.message)));
  },
};
