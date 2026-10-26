import { html, json, sameOrigin } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { planLimits } from '../lib/plans.js';
import { getConnections } from '../lib/users.js';
import { isBot } from '../lib/analytics.js';
import { renderNotFound } from '../lib/kit.js';
import { invoiceId } from '../lib/invoices.js';
import { readProposal, proposalFields, proposalTotal, renderProposal } from '../lib/proposals.js';
import { parseJson } from '../lib/kit-content.js';
import { CURRENCIES } from './deals.js';

// Proposals: a Pro feature. Links already sent keep working if Pro lapses.
const LOCKED = { error: 'Proposals are part of Pro.', locked: true };
const MAX_PROPOSALS = 500;
const ID = /^[a-z2-9]{16}$/;

async function signedIn(request, env, write) {
  if (write && !sameOrigin(request)) return { response: json({ error: 'Bad origin' }, 403) };
  const user = await getSessionUser(request, env);
  if (!user) return { response: json({ error: 'Not signed in' }, 401) };
  return { user, limits: planLimits(user) };
}

export async function onRequestGet({ request, env }) {
  const { user, limits, response } = await signedIn(request, env, false);
  if (response) return response;
  if (!limits.pro) {
    const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM proposals WHERE user_id = ?').bind(user.id).first();
    return json({ ...LOCKED, saved: count });
  }
  const { results } = await env.DB.prepare('SELECT * FROM proposals WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .bind(user.id, MAX_PROPOSALS).all();
  return json({ proposals: results.map(proposalFields) });
}

export async function onRequestPost({ request, env }) {
  const { user, limits, response } = await signedIn(request, env, true);
  if (response) return response;
  if (!limits.pro) return json(LOCKED, 403);
  const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM proposals WHERE user_id = ?').bind(user.id).first();
  if (count >= MAX_PROPOSALS) return json({ error: `You can have up to ${MAX_PROPOSALS} proposals. Delete some old ones first.` }, 400);

  const body = await request.json().catch(() => ({}));
  const { values, error, field } = readProposal(body, CURRENCIES);
  if (error) return json({ error, field }, 400);
  const deal = body.dealId
    ? await env.DB.prepare('SELECT id FROM deals WHERE id = ? AND user_id = ?').bind(body.dealId, user.id).first()
    : null;
  const id = invoiceId();
  const now = Date.now();
  const row = { ...values, deal_id: deal?.id || null };
  const columns = Object.keys(row);
  await env.DB.prepare(`INSERT INTO proposals (id, user_id, ${columns.join(', ')}, created_at, updated_at)
    VALUES (?, ?, ${columns.map(() => '?').join(', ')}, ?, ?)`).bind(id, user.id, ...Object.values(row), now, now).run();
  return json({ ok: true, id });
}

// Editing a proposal the brand asked to change reopens it at the same link
export async function onRequestPut({ request, env, params }) {
  const { user, limits, response } = await signedIn(request, env, true);
  if (response) return response;
  if (!limits.pro) return json(LOCKED, 403);
  const existing = await env.DB.prepare('SELECT * FROM proposals WHERE id = ? AND user_id = ?').bind(params.id, user.id).first();
  if (!existing) return json({ error: 'That proposal no longer exists.' }, 404);
  if (existing.status === 'accepted') return json({ error: 'This proposal was already accepted, so it can\'t be changed. Make a new one instead.' }, 409);
  const { values, error, field } = readProposal(await request.json().catch(() => ({})), CURRENCIES);
  if (error) return json({ error, field }, 400);
  const columns = Object.keys(values);
  await env.DB.prepare(`UPDATE proposals SET ${columns.map((c) => `${c} = ?`).join(', ')}, status = 'open', updated_at = ? WHERE id = ? AND user_id = ?`)
    .bind(...Object.values(values), Date.now(), existing.id, user.id).run();
  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  const { user, response } = await signedIn(request, env, true);
  if (response) return response;
  await env.DB.prepare('DELETE FROM proposals WHERE id = ? AND user_id = ?').bind(params.id, user.id).run();
  return json({ ok: true });
}

async function findProposal(env, id) {
  return ID.test(id) ? env.DB.prepare('SELECT * FROM proposals WHERE id = ?').bind(id).first() : null;
}

// The page brands open: /p/<id>. Views by the brand are counted.
export async function page({ request, env, params, waitUntil }) {
  const viewer = await getSessionUser(request, env);
  const proposal = await findProposal(env, params.id);
  if (!proposal) return html(renderNotFound(viewer), 404);
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(proposal.user_id).first();
  if (!user) return html(renderNotFound(viewer), 404);
  const owner = viewer?.id === user.id;
  if (!owner && !isBot(request)) {
    const now = Date.now();
    waitUntil(env.DB.prepare('UPDATE proposals SET view_count = view_count + 1, first_viewed_at = COALESCE(first_viewed_at, ?), last_viewed_at = ? WHERE id = ?')
      .bind(now, now, proposal.id).run());
  }
  const res = html(renderProposal(proposal, user, await getConnections(env, user.id), { owner, viewer, origin: new URL(request.url).origin }));
  res.headers.set('cache-control', 'private, no-store');
  res.headers.set('x-robots-tag', 'noindex');
  return res;
}

function text(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

async function respondable(request, env, params) {
  if (!sameOrigin(request)) return { response: json({ error: 'Bad origin' }, 403) };
  const proposal = await findProposal(env, params.id);
  if (!proposal) return { response: json({ error: 'This proposal no longer exists.' }, 404) };
  const viewer = await getSessionUser(request, env);
  if (viewer?.id === proposal.user_id) return { response: json({ error: "You can't respond to your own proposal." }, 403) };
  if (proposal.status !== 'open') return { response: json({ error: 'This proposal has already been answered.' }, 409) };
  if (proposal.valid_until && proposal.valid_until < new Date().toISOString().slice(0, 10)) {
    return { response: json({ error: 'This proposal has expired.' }, 409) };
  }
  return { proposal, body: await request.json().catch(() => ({})) };
}

function contact(body, required) {
  const name = text(body.name, 80);
  const email = text(body.email, 254);
  if (required && !name) return { error: 'Enter your name.' };
  if ((required || email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email address.' };
  return { name, email };
}

// Brand accepts: the deal becomes Agreed with the proposal's price and deliverables
export async function accept({ request, env, params }) {
  const { proposal, body, response } = await respondable(request, env, params);
  if (response) return response;
  const who = contact(body, true);
  if (who.error) return json({ error: who.error }, 400);

  const now = Date.now();
  const items = parseJson(proposal.items, []);
  const amountCents = Math.round(proposalTotal(items) * 100);
  const deliverables = items.map((i) => i.description).join(' + ').slice(0, 500);
  const statements = [
    env.DB.prepare(`UPDATE proposals SET status = 'accepted', responder_name = ?, responder_email = ?, responded_at = ?, updated_at = ?
      WHERE id = ? AND status = 'open'`).bind(who.name, who.email, now, now, proposal.id),
  ];
  const deal = proposal.deal_id
    ? await env.DB.prepare('SELECT id FROM deals WHERE id = ? AND user_id = ?').bind(proposal.deal_id, proposal.user_id).first()
    : null;
  if (deal) {
    statements.push(env.DB.prepare(`UPDATE deals SET stage = 'agreed', amount_cents = ?, currency = ?, deliverables = ?,
      contact_name = COALESCE(contact_name, ?), contact_email = COALESCE(contact_email, ?), updated_at = ? WHERE id = ?`)
      .bind(amountCents, proposal.currency, deliverables, who.name, who.email, now, deal.id));
  } else {
    // No deal yet: make one, so the creator can track and invoice it
    const dealId = invoiceId().slice(0, 18);
    statements.push(
      env.DB.prepare(`INSERT INTO deals (id, user_id, brand, contact_name, contact_email, stage, amount_cents, currency, deliverables, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'agreed', ?, ?, ?, ?, ?)`)
        .bind(dealId, proposal.user_id, proposal.brand, proposal.contact_name || who.name, proposal.contact_email || who.email,
          amountCents, proposal.currency, deliverables, now, now),
      env.DB.prepare('UPDATE proposals SET deal_id = ? WHERE id = ?').bind(dealId, proposal.id),
    );
  }
  await env.DB.batch(statements);
  return json({ ok: true });
}

// Brand asks for changes: the creator sees the note and can edit the proposal
export async function requestChanges({ request, env, params }) {
  const { proposal, body, response } = await respondable(request, env, params);
  if (response) return response;
  const note = text(body.note, 1000);
  if (!note) return json({ error: 'Say what you would like changed.' }, 400);
  const who = contact(body, false);
  if (who.error) return json({ error: who.error }, 400);
  const now = Date.now();
  await env.DB.prepare(`UPDATE proposals SET status = 'changes', change_note = ?, responder_name = ?, responder_email = ?, responded_at = ?, updated_at = ?
    WHERE id = ? AND status = 'open'`).bind(note, who.name || null, who.email || null, now, now, proposal.id).run();
  return json({ ok: true });
}
