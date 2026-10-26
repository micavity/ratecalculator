import { html, json, sameOrigin } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { planLimits, hasPlan } from '../lib/plans.js';
import { parseJson } from '../lib/kit-content.js';
import { renderNotFound } from '../lib/kit.js';
import { invoiceId, readInvoice, readSettings, invoiceFields, nextNumber, renderInvoice } from '../lib/invoices.js';
import { CURRENCIES } from './deals.js';

// Invoices: a Pro feature. Like deals, they're kept if Pro lapses, and
// links already sent to brands keep working.
const LOCKED = { error: 'Invoices are part of Pro.', locked: true };
const MAX_INVOICES = 1000;

async function signedIn(request, env, write) {
  if (write && !sameOrigin(request)) return { response: json({ error: 'Bad origin' }, 403) };
  const user = await getSessionUser(request, env);
  if (!user) return { response: json({ error: 'Not signed in' }, 401) };
  return { user, limits: planLimits(user) };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function ownedDeal(env, user, dealId) {
  if (!dealId) return null;
  return env.DB.prepare('SELECT id FROM deals WHERE id = ? AND user_id = ?').bind(dealId, user.id).first();
}

// When an invoice is paid, its deal is too
function markDealPaid(env, user, dealId, paidOn) {
  return env.DB.prepare("UPDATE deals SET stage = 'paid', paid_on = COALESCE(paid_on, ?), updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(paidOn, Date.now(), dealId, user.id);
}

export async function onRequestGet({ request, env }) {
  const { user, limits, response } = await signedIn(request, env, false);
  if (response) return response;
  if (!limits.pro) {
    const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM invoices WHERE user_id = ?').bind(user.id).first();
    return json({ ...LOCKED, saved: count });
  }
  const { results } = await env.DB.prepare('SELECT * FROM invoices WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .bind(user.id, MAX_INVOICES).all();
  return json({
    invoices: results.map(invoiceFields),
    settings: parseJson(user.invoice_settings, {}),
    nextNumber: nextNumber(results.map((r) => r.number)),
    currencies: CURRENCIES,
  });
}

// Saves the creator's details for next time, whenever they make or edit an invoice
function saveSettings(env, user, settings) {
  return env.DB.prepare('UPDATE users SET invoice_settings = ? WHERE id = ?').bind(JSON.stringify(settings), user.id);
}

export async function onRequestPost({ request, env }) {
  const { user, limits, response } = await signedIn(request, env, true);
  if (response) return response;
  if (!limits.pro) return json(LOCKED, 403);

  const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM invoices WHERE user_id = ?').bind(user.id).first();
  if (count >= MAX_INVOICES) return json({ error: `You can have up to ${MAX_INVOICES} invoices. Delete some old ones first.` }, 400);

  const body = await request.json().catch(() => ({}));
  const { values, settings, error, field } = readInvoice(body, CURRENCIES);
  if (error) return json({ error, field }, 400);
  const deal = await ownedDeal(env, user, body.dealId);

  const id = invoiceId();
  const now = Date.now();
  const row = { ...values, deal_id: deal?.id || null, status: 'unpaid' };
  const columns = Object.keys(row);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO invoices (id, user_id, ${columns.join(', ')}, created_at, updated_at)
      VALUES (?, ?, ${columns.map(() => '?').join(', ')}, ?, ?)`).bind(id, user.id, ...Object.values(row), now, now),
    saveSettings(env, user, settings),
  ]);
  return json({ ok: true, id });
}

// Edits an invoice, or just changes its status: { status: 'paid' | 'unpaid' | 'void', paidOn }
export async function onRequestPut({ request, env, params }) {
  const { user, limits, response } = await signedIn(request, env, true);
  if (response) return response;
  if (!limits.pro) return json(LOCKED, 403);

  const existing = await env.DB.prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?').bind(params.id, user.id).first();
  if (!existing) return json({ error: 'That invoice no longer exists.' }, 404);
  const body = await request.json().catch(() => ({}));
  const now = Date.now();

  if (body.statusOnly) {
    if (!['paid', 'unpaid', 'void'].includes(body.status)) return json({ error: 'Unknown status' }, 400);
    const paidOn = body.status === 'paid' ? (/^\d{4}-\d{2}-\d{2}$/.test(body.paidOn || '') ? body.paidOn : today()) : null;
    const statements = [
      env.DB.prepare('UPDATE invoices SET status = ?, paid_on = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .bind(body.status, paidOn, now, existing.id, user.id),
    ];
    if (body.status === 'paid' && existing.deal_id) statements.push(markDealPaid(env, user, existing.deal_id, paidOn));
    await env.DB.batch(statements);
    return json({ ok: true });
  }

  const { values, settings, error, field } = readInvoice(body, CURRENCIES);
  if (error) return json({ error, field }, 400);
  const columns = Object.keys(values);
  await env.DB.batch([
    env.DB.prepare(`UPDATE invoices SET ${columns.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`)
      .bind(...Object.values(values), now, existing.id, user.id),
    saveSettings(env, user, settings),
  ]);
  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  const { user, response } = await signedIn(request, env, true);
  if (response) return response;
  await env.DB.prepare('DELETE FROM invoices WHERE id = ? AND user_id = ?').bind(params.id, user.id).run();
  return json({ ok: true });
}

// Saves just the creator's details (e.g. from the invoice settings form)
export async function settingsPut({ request, env }) {
  const { user, limits, response } = await signedIn(request, env, true);
  if (response) return response;
  if (!limits.pro) return json(LOCKED, 403);
  const { settings, error, field } = readSettings(await request.json().catch(() => ({})));
  if (error) return json({ error, field }, 400);
  await saveSettings(env, user, settings).run();
  return json({ ok: true });
}

// The public invoice page brands open: /i/<id>
export async function page({ request, env, params }) {
  const viewer = await getSessionUser(request, env);
  const invoice = /^[a-z2-9]{16}$/.test(params.id)
    ? await env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(params.id).first()
    : null;
  if (!invoice) return html(renderNotFound(viewer), 404);
  const owner = viewer?.id === invoice.user_id;
  const creator = await env.DB.prepare('SELECT hide_branding, plan, plan_source, plan_expires FROM users WHERE id = ?').bind(invoice.user_id).first();
  const branding = !(creator?.hide_branding && hasPlan(creator, 'essential'));
  const res = html(renderInvoice(invoice, { owner, branding }));
  res.headers.set('cache-control', 'private, no-store');
  res.headers.set('x-robots-tag', 'noindex');
  return res;
}
