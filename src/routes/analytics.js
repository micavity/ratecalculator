import { json } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { hasPlan } from '../lib/plans.js';
import { getAnalytics } from '../lib/analytics.js';

// Detailed analytics: an Essential feature
export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'Not signed in' }, 401);
  if (!hasPlan(user, 'essential')) return json({ error: 'Detailed analytics are part of Essential.', locked: true }, 403);

  const days = new URL(request.url).searchParams.get('days') === '90' ? 90 : 30;
  return json(await getAnalytics(env, user.id, days));
}
