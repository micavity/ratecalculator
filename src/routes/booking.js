import { html, json, redirect, sameOrigin } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { planLimits } from '../lib/plans.js';
import { renderNotFound } from '../lib/kit.js';
import { invoiceId } from '../lib/invoices.js';
import { bookingSettings, bookingOpen, renderBooking, today, SLOT_KINDS } from '../lib/booking.js';

const LOCKED = { error: 'The Book me page is part of Ultra.', locked: true };
const MAX_SLOTS = 60;
// Requests per creator per day, to stop a spammer flooding someone's deals
const MAX_REQUESTS_PER_DAY = 20;

function text(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

async function signedIn(request, env, write) {
  if (write && !sameOrigin(request)) return { response: json({ error: 'Bad origin' }, 403) };
  const user = await getSessionUser(request, env);
  if (!user) return { response: json({ error: 'Not signed in' }, 401) };
  const limits = planLimits(user);
  if (write && !limits.ultra) return { response: json(LOCKED, 403) };
  return { user, limits };
}

function slotFields(s) {
  return { id: s.id, day: s.day, kind: s.kind, note: s.note || '', status: s.status, dealId: s.deal_id || '' };
}

export async function onRequestGet({ request, env }) {
  const { user, limits, response } = await signedIn(request, env, false);
  if (response) return response;
  if (!limits.ultra) return json(LOCKED);
  const { results } = await env.DB.prepare('SELECT * FROM booking_slots WHERE user_id = ? AND day >= ? ORDER BY day LIMIT ?')
    .bind(user.id, today(), MAX_SLOTS).all();
  return json({ settings: bookingSettings(user), slots: results.map(slotFields), kinds: SLOT_KINDS });
}

export async function settingsPut({ request, env }) {
  const { user, response } = await signedIn(request, env, true);
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const settings = { enabled: Boolean(body.enabled), intro: text(body.intro, 600) };
  await env.DB.prepare('UPDATE users SET booking = ? WHERE id = ?').bind(JSON.stringify(settings), user.id).run();
  return json({ ok: true });
}

export async function slotPost({ request, env }) {
  const { user, response } = await signedIn(request, env, true);
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const day = text(body.day, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) return json({ error: 'Pick a date.', field: 'day' }, 400);
  if (day < today()) return json({ error: 'Pick a date in the future.', field: 'day' }, 400);
  const kind = text(body.kind, 60) || 'Other';
  const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM booking_slots WHERE user_id = ? AND day >= ?').bind(user.id, today()).first();
  if (count >= MAX_SLOTS) return json({ error: `You can list up to ${MAX_SLOTS} upcoming dates.` }, 400);
  const id = invoiceId();
  await env.DB.prepare('INSERT INTO booking_slots (id, user_id, day, kind, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, user.id, day, kind, text(body.note, 200) || null, Date.now()).run();
  return json({ ok: true, id });
}

// Reopens a requested date: { status: 'open' }
export async function slotPut({ request, env, params }) {
  const { user, response } = await signedIn(request, env, true);
  if (response) return response;
  await env.DB.prepare("UPDATE booking_slots SET status = 'open', deal_id = NULL WHERE id = ? AND user_id = ?").bind(params.id, user.id).run();
  return json({ ok: true });
}

export async function slotDelete({ request, env, params }) {
  const { user, response } = await signedIn(request, env, true);
  if (response) return response;
  await env.DB.prepare('DELETE FROM booking_slots WHERE id = ? AND user_id = ?').bind(params.id, user.id).run();
  return json({ ok: true });
}

async function creatorFor(env, slug) {
  const user = await env.DB.prepare('SELECT * FROM users WHERE slug = ?').bind(String(slug).toLowerCase()).first();
  return user && bookingOpen(user) ? user : null;
}

// The public page: /book/<kit link>
export async function page({ request, env, params }) {
  const viewer = await getSessionUser(request, env);
  if (params.slug !== params.slug.toLowerCase()) return redirect(`/book/${params.slug.toLowerCase()}`);
  const user = await creatorFor(env, params.slug);
  if (!user) return html(renderNotFound(viewer), 404);
  const { results } = await env.DB.prepare("SELECT * FROM booking_slots WHERE user_id = ? AND status = 'open' AND day >= ? ORDER BY day LIMIT ?")
    .bind(user.id, today(), MAX_SLOTS).all();
  const url = new URL(request.url);
  return html(renderBooking(user, results, { viewer, origin: url.origin, sent: url.searchParams.has('sent') }));
}

// A brand's request: becomes a Negotiating deal, and holds the date
export async function requestPost({ request, env, params }) {
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  const user = await creatorFor(env, params.slug);
  if (!user) return json({ error: 'Bookings are closed right now.' }, 404);
  const viewer = await getSessionUser(request, env);
  if (viewer?.id === user.id) return json({ error: "You can't send a request to yourself." }, 403);
  const body = await request.json().catch(() => ({}));
  if (body.company_site) return json({ ok: true }); // a bot filled the hidden field

  const brand = text(body.brand, 80);
  const name = text(body.name, 80);
  const email = text(body.email, 254);
  const message = text(body.message, 1500);
  if (!brand) return json({ error: 'Enter your brand or company.' }, 400);
  if (!name) return json({ error: 'Enter your name.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
  if (!message) return json({ error: 'Say what you would like to do.' }, 400);
  let website = text(body.website, 200);
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  try {
    website = website ? new URL(website).href.replace(/\/$/, '') : null;
  } catch {
    website = null;
  }

  const now = Date.now();
  const { count } = await env.DB.prepare("SELECT COUNT(*) AS count FROM deals WHERE user_id = ? AND created_at > ? AND notes LIKE 'Booking request%'")
    .bind(user.id, now - 86400000).first();
  if (count >= MAX_REQUESTS_PER_DAY) return json({ error: 'This creator has received a lot of requests today. Please try again tomorrow.' }, 429);

  let slot = null;
  if (body.slotId && body.slotId !== 'flexible') {
    slot = await env.DB.prepare("SELECT * FROM booking_slots WHERE id = ? AND user_id = ? AND status = 'open' AND day >= ?")
      .bind(body.slotId, user.id, today()).first();
    if (!slot) return json({ error: 'That date was just taken. Please pick another.' }, 409);
  }

  const budget = text(body.budget, 60);
  const notes = [
    `Booking request from your Book me page${slot ? ` for ${slot.day} (${slot.kind})` : ' (flexible date)'}.`,
    budget ? `Budget: ${budget}` : '',
    '',
    message,
  ].filter((l, i) => l || i === 2).join('\n').slice(0, 2000);
  const dealId = invoiceId().slice(0, 18);
  const statements = [
    env.DB.prepare(`INSERT INTO deals (id, user_id, brand, website, contact_name, contact_email, stage, currency, deliverables, due_date, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'negotiating', 'USD', ?, ?, ?, ?, ?)`)
      .bind(dealId, user.id, brand, website, name, email, slot?.kind || null, slot?.day || null, notes, now, now),
  ];
  if (slot) {
    statements.push(env.DB.prepare("UPDATE booking_slots SET status = 'requested', deal_id = ? WHERE id = ? AND status = 'open'").bind(dealId, slot.id));
  }
  await env.DB.batch(statements);
  return json({ ok: true });
}
