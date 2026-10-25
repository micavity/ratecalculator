import { json, sameOrigin } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { getConnections, refreshStats } from '../lib/users.js';

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'Not signed in' }, 401);

  const refreshed = await refreshStats(env, user.id, { manual: true });
  return json({ refreshed, connections: await getConnections(env, user.id) });
}
