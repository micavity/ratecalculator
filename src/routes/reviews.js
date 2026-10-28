import { json, sameOrigin } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { invoiceId } from '../lib/invoices.js';
import { readReview, SNOOZE_DAYS } from '../lib/reviews.js';

async function creator(request, env) {
  if (!sameOrigin(request)) return { response: json({ error: 'Bad origin' }, 403) };
  const user = await getSessionUser(request, env, { creatorOnly: true });
  if (!user) return { response: json({ error: 'Not signed in' }, 401) };
  return { user };
}

// { rating: 1-5, comment, publicOk }
export async function onRequestPost({ request, env }) {
  const { user, response } = await creator(request, env);
  if (response) return response;
  const { value, error } = readReview(await request.json().catch(() => ({})));
  if (error) return json({ error }, 400);
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM reviews WHERE user_id = ? AND created_at > ?').bind(user.id, Date.now() - 86400000).first();
  if (recent.n) return json({ error: 'Thanks, we already have your review!' }, 409);
  await env.DB.prepare('INSERT INTO reviews (id, user_id, rating, comment, public_ok, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(invoiceId(), user.id, value.rating, value.comment, value.publicOk, Date.now()).run();
  return json({ ok: true });
}

// "Maybe later" asks again in 2 weeks; "Don't ask again" stops asking
export async function later({ request, env }) {
  const { user, response } = await creator(request, env);
  if (response) return response;
  await env.DB.prepare('UPDATE users SET review_snooze_until = ? WHERE id = ?').bind(Date.now() + SNOOZE_DAYS * 86400000, user.id).run();
  return json({ ok: true });
}

export async function never({ request, env }) {
  const { user, response } = await creator(request, env);
  if (response) return response;
  await env.DB.prepare('UPDATE users SET review_opt_out = 1 WHERE id = ?').bind(user.id).run();
  return json({ ok: true });
}
