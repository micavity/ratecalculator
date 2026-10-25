import { json, sameOrigin } from '../lib/http.js';
import { destroySession } from '../lib/session.js';

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  return json({ ok: true }, 200, { 'set-cookie': await destroySession(request, env) });
}
