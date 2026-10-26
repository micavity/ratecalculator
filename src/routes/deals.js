import { json, sameOrigin } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { planLimits } from '../lib/plans.js';

// Deal tracker: a Pro feature. Deals are the creator's private records;
// when a plan lapses they're kept but hidden.
export const STAGES = ['pitched', 'negotiating', 'agreed', 'delivered', 'paid', 'lost'];
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'CHF', 'JPY', 'BRL', 'MXN', 'INR', 'PLN'];

const LOCKED = { error: 'The deal tracker is part of Pro.', locked: true };

async function signedIn(request, env, write) {
  if (write && !sameOrigin(request)) return { response: json({ error: 'Bad origin' }, 403) };
  const user = await getSessionUser(request, env);
  if (!user) return { response: json({ error: 'Not signed in' }, 401) };
  return { user, limits: planLimits(user) };
}

function dealId() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function text(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function date(value) {
  const v = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null;
}

function website(value) {
  let v = text(value, 200);
  if (!v) return { value: null };
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try {
    const url = new URL(v);
    if (!url.hostname.includes('.')) throw new Error();
    return { value: url.href.replace(/\/$/, '') };
  } catch {
    return { error: "That website doesn't look right. Try something like razer.com." };
  }
}

// Checks a deal from the dashboard. Returns { values } or { error, field }.
async function readDeal(env, user, body) {
  const fail = (field, error) => ({ field, error });
  const brand = text(body.brand, 80);
  if (!brand) return fail('brand', 'Enter the brand name.');

  const site = website(body.website);
  if (site.error) return fail('website', site.error);

  const contactEmail = text(body.contactEmail, 254);
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return fail('contactEmail', "That email address doesn't look right.");

  const stage = STAGES.includes(body.stage) ? body.stage : 'pitched';
  const currency = CURRENCIES.includes(body.currency) ? body.currency : 'USD';

  let amountCents = null;
  if (body.amount !== '' && body.amount !== null && body.amount !== undefined) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 10000000) return fail('amount', 'Enter an amount between 0 and 10,000,000.');
    amountCents = Math.round(amount * 100);
  }

  const dates = {};
  for (const key of ['dueDate', 'paymentDue', 'paidOn']) {
    if (body[key] && !date(body[key])) return fail(key, 'Enter a valid date.');
    dates[key] = date(body[key]);
  }

  let linkId = null;
  if (body.linkId) {
    const link = await env.DB.prepare('SELECT id FROM tracked_links WHERE id = ? AND user_id = ?').bind(body.linkId, user.id).first();
    linkId = link ? link.id : null;
  }

  return {
    values: {
      brand,
      website: site.value,
      contact_name: text(body.contactName, 80) || null,
      contact_email: contactEmail || null,
      stage,
      amount_cents: amountCents,
      currency,
      deliverables: text(body.deliverables, 500) || null,
      due_date: dates.dueDate,
      payment_due: dates.paymentDue,
      paid_on: stage === 'paid' ? dates.paidOn : null,
      notes: text(body.notes, 2000) || null,
      link_id: linkId,
    },
  };
}

function dealFields(d) {
  return {
    id: d.id,
    brand: d.brand,
    website: d.website || '',
    contactName: d.contact_name || '',
    contactEmail: d.contact_email || '',
    stage: d.stage,
    amount: d.amount_cents === null ? null : d.amount_cents / 100,
    currency: d.currency,
    deliverables: d.deliverables || '',
    dueDate: d.due_date || '',
    paymentDue: d.payment_due || '',
    paidOn: d.paid_on || '',
    notes: d.notes || '',
    linkId: d.link_id || '',
    linkLabel: d.link_label || '',
    invoice: d.invoice ? JSON.parse(d.invoice) : null,
    lastOpenedAt: d.last_opened_at || null,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
}

export async function onRequestGet({ request, env }) {
  const { user, limits, response } = await signedIn(request, env, false);
  if (response) return response;
  if (!limits.pro) {
    const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM deals WHERE user_id = ?').bind(user.id).first();
    return json({ ...LOCKED, saved: count });
  }
  const { results } = await env.DB.prepare(`SELECT d.*, l.label AS link_label,
      (SELECT MAX(e.at) FROM link_events e WHERE e.user_id = d.user_id AND e.link_id = d.link_id) AS last_opened_at,
      (SELECT json_object('id', i.id, 'number', i.number, 'status', i.status, 'dueOn', i.due_on) FROM invoices i
        WHERE i.deal_id = d.id AND i.user_id = d.user_id AND i.status != 'void' ORDER BY i.created_at DESC LIMIT 1) AS invoice
    FROM deals d LEFT JOIN tracked_links l ON l.id = d.link_id AND l.user_id = d.user_id
    WHERE d.user_id = ? ORDER BY d.updated_at DESC LIMIT ?`).bind(user.id, limits.deals).all();
  return json({ deals: results.map(dealFields), stages: STAGES, currencies: CURRENCIES });
}

export async function onRequestPost({ request, env }) {
  const { user, limits, response } = await signedIn(request, env, true);
  if (response) return response;
  if (!limits.pro) return json(LOCKED, 403);

  const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM deals WHERE user_id = ?').bind(user.id).first();
  if (count >= limits.deals) return json({ error: `You can have up to ${limits.deals} deals. Delete some old ones first.` }, 400);

  const { values, error, field } = await readDeal(env, user, await request.json().catch(() => ({})));
  if (error) return json({ error, field }, 400);
  const id = dealId();
  const now = Date.now();
  const columns = Object.keys(values);
  await env.DB.prepare(`INSERT INTO deals (id, user_id, ${columns.join(', ')}, created_at, updated_at)
    VALUES (?, ?, ${columns.map(() => '?').join(', ')}, ?, ?)`)
    .bind(id, user.id, ...Object.values(values), now, now).run();
  return json({ ok: true, id });
}

export async function onRequestPut({ request, env, params }) {
  const { user, limits, response } = await signedIn(request, env, true);
  if (response) return response;
  if (!limits.pro) return json(LOCKED, 403);

  const existing = await env.DB.prepare('SELECT id FROM deals WHERE id = ? AND user_id = ?').bind(params.id, user.id).first();
  if (!existing) return json({ error: 'That deal no longer exists.' }, 404);
  const { values, error, field } = await readDeal(env, user, await request.json().catch(() => ({})));
  if (error) return json({ error, field }, 400);
  const columns = Object.keys(values);
  const statements = [
    env.DB.prepare(`UPDATE deals SET ${columns.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`)
      .bind(...Object.values(values), Date.now(), existing.id, user.id),
  ];
  // A paid deal means its invoice was paid too
  if (values.stage === 'paid') {
    statements.push(env.DB.prepare("UPDATE invoices SET status = 'paid', paid_on = ?, updated_at = ? WHERE deal_id = ? AND user_id = ? AND status = 'unpaid'")
      .bind(values.paid_on || new Date().toISOString().slice(0, 10), Date.now(), existing.id, user.id));
  }
  await env.DB.batch(statements);
  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  const { user, response } = await signedIn(request, env, true);
  if (response) return response;
  // Invoices already sent stay, they just stop pointing at the deal
  await env.DB.batch([
    env.DB.prepare('UPDATE invoices SET deal_id = NULL WHERE deal_id = ? AND user_id = ?').bind(params.id, user.id),
    env.DB.prepare('DELETE FROM deals WHERE id = ? AND user_id = ?').bind(params.id, user.id),
  ]);
  return json({ ok: true });
}
