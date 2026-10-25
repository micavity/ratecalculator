import { json, sameOrigin } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';

// Unlinks a platform. Linked accounts are also how creators sign in,
// so the last one can't be removed.
export async function onRequestDelete({ request, env, params }) {
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'Not signed in' }, 401);

  const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM connections WHERE user_id = ?').bind(user.id).first();
  if (count <= 1) {
    return json({ error: 'You need at least one linked account to sign in. Link another platform first.' }, 400);
  }

  await env.DB.prepare('DELETE FROM connections WHERE user_id = ? AND provider = ?').bind(user.id, params.provider).run();
  return json({ ok: true });
}
