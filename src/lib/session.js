import { cookie, getCookie, randomToken, sha256 } from './http.js';
import { hasPlan } from './plans.js';

const SESSION_COOKIE = 'cgg_session';
const MANAGER_COOKIE = 'cgg_mgr';
const SESSION_DAYS = 30;

export async function createSession(env, userId) {
  const token = randomToken();
  const expiresAt = Date.now() + SESSION_DAYS * 86400 * 1000;
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, expiresAt)
    .run();
  return cookie(SESSION_COOKIE, token, SESSION_DAYS * 86400);
}

// A manager's session works on behalf of the creator who invited them
export async function createManagerSession(env, managerId, creatorId) {
  const token = randomToken();
  const expiresAt = Date.now() + SESSION_DAYS * 86400 * 1000;
  await env.DB.prepare('INSERT INTO manager_sessions (token_hash, manager_id, creator_id, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), managerId, creatorId, expiresAt).run();
  return cookie(MANAGER_COOKIE, token, SESSION_DAYS * 86400);
}

/**
 * The signed-in creator. A manager signed in with a passkey gets the creator
 * they manage, with `user.manager = { id, name, role }` set, as long as the
 * creator still has Ultra and hasn't removed them. Pass creatorOnly for
 * things only the creator may do: billing, deleting the account, admin,
 * linking accounts, payouts and team changes.
 */
export async function getSessionUser(request, env, { creatorOnly = false } = {}) {
  const token = getCookie(request, SESSION_COOKIE);
  if (token) {
    const row = await env.DB.prepare(
      `SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    ).bind(await sha256(token), Date.now()).first();
    if (row) return row;
  }
  if (creatorOnly) return null;
  return getManagedCreator(request, env);
}

async function getManagedCreator(request, env) {
  const token = getCookie(request, MANAGER_COOKIE);
  if (!token) return null;
  const session = await env.DB.prepare(
    `SELECT s.manager_id, s.creator_id, m.name, t.role FROM manager_sessions s
     JOIN managers m ON m.id = s.manager_id
     JOIN team_members t ON t.creator_id = s.creator_id AND t.manager_id = s.manager_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(await sha256(token), Date.now()).first();
  if (!session) return null;
  const creator = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(session.creator_id).first();
  if (!creator || !hasPlan(creator, 'ultra')) return null;
  return { ...creator, manager: { id: session.manager_id, name: session.name, role: session.role } };
}

// Signs out both kinds of session. Returns the cookies to clear.
export async function destroySession(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  }
  const managerToken = getCookie(request, MANAGER_COOKIE);
  if (managerToken) {
    await env.DB.prepare('DELETE FROM manager_sessions WHERE token_hash = ?').bind(await sha256(managerToken)).run();
  }
  return [cookie(SESSION_COOKIE, '', 0), cookie(MANAGER_COOKIE, '', 0)];
}

export function clearManagerCookie() {
  return cookie(MANAGER_COOKIE, '', 0);
}

export function clearCreatorCookie() {
  return cookie(SESSION_COOKIE, '', 0);
}
