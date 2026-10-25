import { json, sameOrigin } from '../../lib/http.js';
import { getSessionUser } from '../../lib/session.js';
import { validateProfile, updateProfile } from '../../lib/users.js';

export async function onRequestPut({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'Not signed in' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request' }, 400);
  }

  const { values, error, field } = validateProfile(body);
  if (error) return json({ error, field }, 400);

  if (values.slug !== user.slug) {
    const taken = await env.DB.prepare('SELECT 1 FROM users WHERE slug = ? AND id != ?').bind(values.slug, user.id).first();
    if (taken) return json({ error: 'That link is already taken.', field: 'slug' }, 409);
  }

  try {
    await updateProfile(env, user.id, values);
  } catch (err) {
    // Someone else grabbed the link between the check and the update
    if (String(err.message).includes('UNIQUE')) return json({ error: 'That link is already taken.', field: 'slug' }, 409);
    throw err;
  }
  return json({ ok: true });
}
