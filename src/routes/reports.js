import { html, json, sameOrigin } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { planLimits } from '../lib/plans.js';
import { parseJson } from '../lib/kit-content.js';
import { renderNotFound } from '../lib/kit.js';
import { invoiceId } from '../lib/invoices.js';
import { withVideoStats } from '../lib/video-stats.js';
import { readReport, reportFields, refreshReport, renderReport, STATS_MAX_AGE } from '../lib/reports.js';

const LOCKED = { error: 'Campaign reports are part of Ultra.', locked: true };
const MAX_REPORTS = 300;

async function signedIn(request, env, write) {
  if (write && !sameOrigin(request)) return { response: json({ error: 'Bad origin' }, 403) };
  const user = await getSessionUser(request, env);
  if (!user) return { response: json({ error: 'Not signed in' }, 401) };
  const limits = planLimits(user);
  return { user, limits };
}

export async function onRequestGet({ request, env }) {
  const { user, limits, response } = await signedIn(request, env, false);
  if (response) return response;
  if (!limits.ultra) {
    const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM campaign_reports WHERE user_id = ?').bind(user.id).first();
    return json({ ...LOCKED, saved: count });
  }
  const { results } = await env.DB.prepare('SELECT * FROM campaign_reports WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').bind(user.id, MAX_REPORTS).all();
  return json({ reports: results.map(reportFields) });
}

async function save(request, env, params) {
  const { user, limits, response } = await signedIn(request, env, true);
  if (response) return response;
  if (!limits.ultra) return json(LOCKED, 403);
  const existing = params?.id
    ? await env.DB.prepare('SELECT * FROM campaign_reports WHERE id = ? AND user_id = ?').bind(params.id, user.id).first()
    : null;
  if (params?.id && !existing) return json({ error: 'That report no longer exists.' }, 404);
  if (!existing) {
    const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM campaign_reports WHERE user_id = ?').bind(user.id).first();
    if (count >= MAX_REPORTS) return json({ error: `You can have up to ${MAX_REPORTS} reports. Delete some old ones first.` }, 400);
  }
  const body = await request.json().catch(() => ({}));
  const { values, error, field } = readReport(body, parseJson(existing?.content, []));
  if (error) return json({ error, field }, 400);
  const content = await withVideoStats(env, values.content);
  const deal = body.dealId ? await env.DB.prepare('SELECT id FROM deals WHERE id = ? AND user_id = ?').bind(body.dealId, user.id).first() : null;
  const now = Date.now();
  if (existing) {
    await env.DB.prepare(`UPDATE campaign_reports SET brand = ?, title = ?, content = ?, clicks = ?, conversions = ?, summary = ?, stats_updated_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ?`).bind(values.brand, values.title, JSON.stringify(content), values.clicks, values.conversions, values.summary, now, now, existing.id, user.id).run();
    return json({ ok: true, id: existing.id });
  }
  const id = invoiceId();
  await env.DB.prepare(`INSERT INTO campaign_reports (id, user_id, deal_id, brand, title, content, clicks, conversions, summary, stats_updated_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, user.id, deal?.id || null, values.brand, values.title, JSON.stringify(content), values.clicks, values.conversions, values.summary, now, now, now).run();
  return json({ ok: true, id });
}

export const onRequestPost = ({ request, env }) => save(request, env, null);
export const onRequestPut = ({ request, env, params }) => save(request, env, params);

export async function onRequestDelete({ request, env, params }) {
  const { user, response } = await signedIn(request, env, true);
  if (response) return response;
  await env.DB.prepare('DELETE FROM campaign_reports WHERE id = ? AND user_id = ?').bind(params.id, user.id).run();
  return json({ ok: true });
}

// The page brands open: /r/<id>. Stats refresh when they're over 6 hours old.
export async function page({ request, env, params }) {
  const viewer = await getSessionUser(request, env);
  let row = /^[a-z2-9]{16}$/.test(params.id) ? await env.DB.prepare('SELECT * FROM campaign_reports WHERE id = ?').bind(params.id).first() : null;
  if (!row) return html(renderNotFound(viewer), 404);
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(row.user_id).first();
  if (!user) return html(renderNotFound(viewer), 404);
  if (!row.stats_updated_at || Date.now() - row.stats_updated_at > STATS_MAX_AGE) {
    row = await refreshReport(env, row).catch((err) => {
      console.error('Report refresh failed:', err.message);
      return row;
    });
  }
  const url = new URL(request.url);
  const res = html(renderReport(row, user, { viewer, origin: url.origin, host: url.hostname }));
  res.headers.set('cache-control', 'private, no-store');
  res.headers.set('x-robots-tag', 'noindex');
  return res;
}
