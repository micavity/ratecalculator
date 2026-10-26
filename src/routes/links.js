import { json, sameOrigin } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { planLimits } from '../lib/plans.js';

// Tracked brand links: an Essential feature. Each link has a random code,
// so brands see /yourname?for=k3j9x2qa rather than their own name.
function linkCode() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'Not signed in' }, 401);
  const limits = planLimits(user);
  if (!limits.essential) return json({ error: 'Tracked brand links are part of Essential.', locked: true }, 403);

  const body = await request.json().catch(() => ({}));
  const label = String(body.label ?? '').trim().slice(0, 60);
  if (!label) return json({ error: 'Enter who this link is for, like a brand name.', field: 'label' }, 400);

  const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM tracked_links WHERE user_id = ?').bind(user.id).first();
  if (count >= limits.trackedLinks) return json({ error: `You can have up to ${limits.trackedLinks} tracked links. Delete an old one first.` }, 400);

  let versionId = null;
  if (body.versionId) {
    const version = await env.DB.prepare('SELECT id FROM kit_versions WHERE id = ? AND user_id = ?').bind(body.versionId, user.id).first();
    if (!version) return json({ error: 'That kit version no longer exists.' }, 400);
    versionId = version.id;
  }

  const id = linkCode();
  await env.DB.prepare('INSERT INTO tracked_links (id, user_id, label, version_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, user.id, label, versionId, Date.now()).run();
  return json({ ok: true, id });
}

export async function onRequestDelete({ request, env, params }) {
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'Not signed in' }, 401);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM link_events WHERE link_id = ? AND user_id = ?').bind(params.id, user.id),
    env.DB.prepare('DELETE FROM tracked_links WHERE id = ? AND user_id = ?').bind(params.id, user.id),
  ]);
  return json({ ok: true });
}
