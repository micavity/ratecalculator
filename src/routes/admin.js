// Admin-only tools. Admins are listed by CreatorGG account ID in the
// ADMIN_USER_IDS secret (comma-separated). Everyone else gets a 404, so
// the admin page doesn't reveal that it exists.
import { json, sameOrigin, html } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { PLAN_RANK, planInfo } from '../lib/plans.js';
import { renderAdminPage } from '../lib/admin-page.js';
import { REFERRAL } from '../lib/referrals.js';

function isAdmin(env, user) {
  const ids = String(env.ADMIN_USER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
  return Boolean(user && ids.includes(user.id));
}

async function requireAdmin(request, env, { write = false } = {}) {
  if (write && !sameOrigin(request)) return { response: json({ error: 'Bad origin' }, 403) };
  const user = await getSessionUser(request, env);
  if (!isAdmin(env, user)) return { response: json({ error: 'Not found' }, 404) };
  return { user };
}

export async function page({ request, env, next }) {
  const user = await getSessionUser(request, env);
  if (!isAdmin(env, user)) return next();
  return html(renderAdminPage());
}

function daysAgo(days) {
  return Date.now() - days * 86400000;
}

export async function stats({ request, env }) {
  const { response } = await requireAdmin(request, env);
  if (response) return response;

  const now = Date.now();
  const since30 = new Date(daysAgo(29)).toISOString().slice(0, 10);
  const [totals, plans, views] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS creators,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS week,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS month,
        SUM(founding) AS founding
      FROM users`).bind(daysAgo(7), daysAgo(30)).first(),
    env.DB.prepare(`SELECT plan, plan_source AS source, COUNT(*) AS count FROM users
      WHERE plan != 'free' AND (plan_expires IS NULL OR plan_expires > ?)
      GROUP BY plan, plan_source`).bind(now).all(),
    env.DB.prepare('SELECT COALESCE(SUM(views), 0) AS views FROM kit_views WHERE day >= ?').bind(since30).first(),
  ]);
  return json({
    creators: totals.creators || 0,
    signupsWeek: totals.week || 0,
    signupsMonth: totals.month || 0,
    founding: totals.founding || 0,
    plans: plans.results,
    kitViews30: views.views,
  });
}

export async function users({ request, env }) {
  const { response } = await requireAdmin(request, env);
  if (response) return response;

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60);
  const page = Math.max(0, Number(url.searchParams.get('page')) || 0);
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const since30 = new Date(daysAgo(29)).toISOString().slice(0, 10);

  const { results } = await env.DB.prepare(
    `SELECT u.*,
       (SELECT GROUP_CONCAT(c.provider || ':' || c.username, '|') FROM connections c WHERE c.user_id = u.id) AS platforms,
       (SELECT COALESCE(SUM(v.views), 0) FROM kit_views v WHERE v.user_id = u.id AND v.day >= ?) AS views30
     FROM users u
     WHERE ? = '' OR u.slug LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\'
       OR EXISTS (SELECT 1 FROM connections c WHERE c.user_id = u.id AND c.username LIKE ? ESCAPE '\\')
     ORDER BY u.created_at DESC
     LIMIT 26 OFFSET ?`,
  ).bind(since30, q, like, like, like, page * 25).all();

  return json({
    page,
    hasMore: results.length > 25,
    users: results.slice(0, 25).map((u) => ({
      id: u.id,
      slug: u.slug,
      displayName: u.display_name,
      avatarUrl: u.avatar_url,
      createdAt: u.created_at,
      platforms: (u.platforms || '').split('|').filter(Boolean).map((p) => {
        const [provider, ...name] = p.split(':');
        return { provider, username: name.join(':') };
      }),
      views30: u.views30,
      plan: planInfo(u),
      storedPlan: u.plan,
    })),
  });
}

// Gift a plan: { plan: 'essential' | 'pro' | 'ultra' | 'free', months: number | null }.
// months null means it never expires; plan 'free' removes a gift.
export async function setPlan({ request, env, params }) {
  const { response } = await requireAdmin(request, env, { write: true });
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  if (!(body.plan in PLAN_RANK)) return json({ error: 'Unknown plan' }, 400);
  const target = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(params.id).first();
  if (!target) return json({ error: 'Creator not found' }, 404);

  if (body.plan === 'free') {
    await env.DB.prepare("UPDATE users SET plan = 'free', plan_source = '', plan_expires = NULL WHERE id = ?").bind(target.id).run();
  } else {
    const months = body.months === null || body.months === undefined ? null : Number(body.months);
    if (months !== null && !(Number.isInteger(months) && months > 0 && months <= 120)) {
      return json({ error: 'Choose a length between 1 and 120 months, or lifetime.' }, 400);
    }
    const expires = months === null ? null : Date.now() + months * 30 * 86400000;
    await env.DB.prepare("UPDATE users SET plan = ?, plan_source = 'gift', plan_expires = ? WHERE id = ?")
      .bind(body.plan, expires, target.id).run();
  }
  const updated = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(target.id).first();
  return json({ ok: true, plan: planInfo(updated) });
}

export async function setFounding({ request, env, params }) {
  const { response } = await requireAdmin(request, env, { write: true });
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const result = await env.DB.prepare('UPDATE users SET founding = ? WHERE id = ?').bind(body.founding ? 1 : 0, params.id).run();
  if (!result.meta?.changes) return json({ error: 'Creator not found' }, 404);
  return json({ ok: true });
}

// Everyone who has referred a creator or earned a commission, with totals
export async function affiliates({ request, env }) {
  const { response } = await requireAdmin(request, env);
  if (response) return response;
  const now = Date.now();
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.display_name AS displayName, r.slug, r.referral_code AS code, r.payout_email AS payoutEmail,
       (SELECT COUNT(*) FROM users u WHERE u.referred_by = r.id) AS signups,
       (SELECT COUNT(*) FROM users u WHERE u.referred_by = r.id AND u.first_paid_at IS NOT NULL) AS paying,
       (SELECT COUNT(*) FROM users u WHERE u.referred_by = r.id AND u.subscription_status IN ('active', 'trialing', 'past_due')) AS subscribed,
       COALESCE((SELECT SUM(amount_cents) FROM commissions c WHERE c.referrer_id = r.id AND c.status != 'void'), 0) AS revenueCents,
       COALESCE((SELECT SUM(commission_cents) FROM commissions c WHERE c.referrer_id = r.id AND c.status = 'pending' AND c.available_at <= ?), 0) AS availableCents,
       COALESCE((SELECT SUM(commission_cents) FROM commissions c WHERE c.referrer_id = r.id AND c.status = 'pending' AND c.available_at > ?), 0) AS heldCents,
       COALESCE((SELECT SUM(commission_cents) FROM commissions c WHERE c.referrer_id = r.id AND c.status = 'paid'), 0) AS paidCents
     FROM users r
     WHERE EXISTS (SELECT 1 FROM users u WHERE u.referred_by = r.id)
        OR EXISTS (SELECT 1 FROM commissions c WHERE c.referrer_id = r.id)
     ORDER BY availableCents DESC, revenueCents DESC, signups DESC`,
  ).bind(now, now).all();

  const totals = results.reduce((t, a) => {
    for (const key of ['signups', 'paying', 'subscribed', 'revenueCents', 'availableCents', 'heldCents', 'paidCents']) t[key] += a[key];
    return t;
  }, { signups: 0, paying: 0, subscribed: 0, revenueCents: 0, availableCents: 0, heldCents: 0, paidCents: 0 });

  return json({ minPayoutCents: REFERRAL.minPayoutCents, totals, affiliates: results });
}

// The creators one affiliate referred
export async function affiliateDetail({ request, env, params }) {
  const { response } = await requireAdmin(request, env);
  if (response) return response;
  const { results } = await env.DB.prepare(
    `SELECT u.*,
       COALESCE((SELECT SUM(amount_cents) FROM commissions c WHERE c.referred_id = u.id AND c.referrer_id = ? AND c.status != 'void'), 0) AS revenue_cents,
       COALESCE((SELECT SUM(commission_cents) FROM commissions c WHERE c.referred_id = u.id AND c.referrer_id = ? AND c.status != 'void'), 0) AS commission_cents
     FROM users u WHERE u.referred_by = ? ORDER BY u.created_at DESC LIMIT 200`,
  ).bind(params.id, params.id, params.id).all();
  return json({
    referred: results.map((u) => ({
      id: u.id,
      displayName: u.display_name,
      slug: u.slug,
      joinedAt: u.created_at,
      firstPaidAt: u.first_paid_at,
      subscriptionStatus: u.subscription_status,
      plan: planInfo(u),
      revenueCents: u.revenue_cents,
      commissionCents: u.commission_cents,
    })),
  });
}

// Marks everything currently available as paid, after you've sent the money
export async function markPaid({ request, env, params }) {
  const { response } = await requireAdmin(request, env, { write: true });
  if (response) return response;
  const now = Date.now();
  const due = await env.DB.prepare(
    "SELECT COALESCE(SUM(commission_cents), 0) AS cents FROM commissions WHERE referrer_id = ? AND status = 'pending' AND available_at <= ?",
  ).bind(params.id, now).first();
  await env.DB.prepare(
    "UPDATE commissions SET status = 'paid', paid_at = ? WHERE referrer_id = ? AND status = 'pending' AND available_at <= ?",
  ).bind(now, params.id, now).run();
  return json({ ok: true, paidCents: due.cents });
}
