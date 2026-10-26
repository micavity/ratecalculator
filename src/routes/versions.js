import { json, sameOrigin } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { planLimits } from '../lib/plans.js';
import { validateVersion, versionFields } from '../lib/versions.js';
import { withVideoStats } from '../lib/video-stats.js';
import { parseJson } from '../lib/kit-content.js';

async function essentialUser(request, env) {
  if (!sameOrigin(request)) return { response: json({ error: 'Bad origin' }, 403) };
  const user = await getSessionUser(request, env);
  if (!user) return { response: json({ error: 'Not signed in' }, 401) };
  const limits = planLimits(user);
  if (!limits.essential) return { response: json({ error: 'Kit versions are part of Essential.', locked: true }, 403) };
  return { user, limits };
}

async function keyTaken(env, userId, key, exceptId = '') {
  return env.DB.prepare('SELECT 1 FROM kit_versions WHERE user_id = ? AND key = ? AND id != ?').bind(userId, key, exceptId).first();
}

// Creates a version that starts out identical to the main kit
export async function onRequestPost({ request, env }) {
  const { user, limits, response } = await essentialUser(request, env);
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const result = validateVersion({ name: body.name, key: body.key }, limits.featured);
  if (result.error) return json(result, 400);

  const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM kit_versions WHERE user_id = ?').bind(user.id).first();
  if (count >= limits.versions) return json({ error: `Your plan includes ${limits.versions} extra kit versions.` }, 400);
  if (await keyTaken(env, user.id, result.key)) return json({ error: 'You already have a version with that link.', field: 'key' }, 409);

  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO kit_versions (id, user_id, key, name, overrides, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, user.id, result.key, result.name, '{}', now, now).run();
  const version = await env.DB.prepare('SELECT * FROM kit_versions WHERE id = ?').bind(id).first();
  return json({ ok: true, version: versionFields(version) });
}

export async function onRequestPut({ request, env, params }) {
  const { user, limits, response } = await essentialUser(request, env);
  if (response) return response;

  const existing = await env.DB.prepare('SELECT * FROM kit_versions WHERE id = ? AND user_id = ?').bind(params.id, user.id).first();
  if (!existing) return json({ error: 'Version not found' }, 404);

  const body = await request.json().catch(() => ({}));
  const result = validateVersion(body, limits.featured);
  if (result.error) return json(result, 400);
  if (await keyTaken(env, user.id, result.key, existing.id)) return json({ error: 'You already have a version with that link.', field: 'key' }, 409);

  // Keep stats we already have for unchanged videos, then fetch fresh ones
  if (result.overrides.featured) {
    const previous = parseJson(existing.overrides, {}).featured || [];
    result.overrides.featured = await withVideoStats(env, result.overrides.featured.map((v) => ({
      ...previous.find((p) => p.type === v.type && p.id === v.id),
      ...v,
    })));
  }

  await env.DB.prepare('UPDATE kit_versions SET name = ?, key = ?, overrides = ?, updated_at = ? WHERE id = ?')
    .bind(result.name, result.key, JSON.stringify(result.overrides), Date.now(), existing.id).run();
  const version = await env.DB.prepare('SELECT * FROM kit_versions WHERE id = ?').bind(existing.id).first();
  return json({ ok: true, version: versionFields(version) });
}

// Deleting is allowed on any plan, so lapsed creators can tidy up
export async function onRequestDelete({ request, env, params }) {
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'Not signed in' }, 401);
  await env.DB.batch([
    env.DB.prepare('UPDATE tracked_links SET version_id = NULL WHERE version_id = ? AND user_id = ?').bind(params.id, user.id),
    env.DB.prepare('DELETE FROM kit_versions WHERE id = ? AND user_id = ?').bind(params.id, user.id),
  ]);
  return json({ ok: true });
}
