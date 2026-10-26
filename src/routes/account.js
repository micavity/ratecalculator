import { json, sameOrigin, cookie } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { USER_DATA_TABLES } from '../lib/users.js';
import { cancelSubscriptionNow } from '../lib/billing.js';

// Permanently deletes the signed-in creator's profile and everything linked to it
export async function onRequestDelete({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'Not signed in' }, 401);

  // Stop billing before the account goes away
  try {
    await cancelSubscriptionNow(env, user);
  } catch (err) {
    console.error('Cancelling subscription failed:', err.message);
    return json({ error: "We couldn't cancel your subscription, so your account wasn't deleted. Please try again in a moment." }, 502);
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM commissions WHERE referrer_id = ? AND status != 'paid'").bind(user.id),
    ...USER_DATA_TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(user.id)),
    env.DB.prepare('DELETE FROM connections WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
  return json({ ok: true }, 200, { 'set-cookie': cookie('cgg_session', '', 0) });
}
