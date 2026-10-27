import { json, sameOrigin } from '../lib/http.js';
import { destroySession } from '../lib/session.js';

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  const res = json({ ok: true });
  for (const c of await destroySession(request, env)) res.headers.append('set-cookie', c);
  return res;
}
