import { json } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { getConnections } from '../lib/users.js';
import { buildProjections } from '../lib/projections.js';

// Growth projections for the dashboard; each plan sees a little more
export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'Not signed in' }, 401);
  return json(await buildProjections(env, user, await getConnections(env, user.id)));
}
