import { cookie, getCookie, randomToken, sha256 } from './http.js';

const SESSION_COOKIE = 'cgg_session';
const SESSION_DAYS = 30;

export async function createSession(env, userId) {
  const token = randomToken();
  const expiresAt = Date.now() + SESSION_DAYS * 86400 * 1000;
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, expiresAt)
    .run();
  return cookie(SESSION_COOKIE, token, SESSION_DAYS * 86400);
}

export async function getSessionUser(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
  ).bind(await sha256(token), Date.now()).first();
  return row || null;
}

export async function destroySession(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  }
  return cookie(SESSION_COOKIE, '', 0);
}
