import { html, json, sameOrigin, randomToken, sha256, escapeHtml as e } from '../lib/http.js';
import { getSessionUser, createManagerSession, clearCreatorCookie } from '../lib/session.js';
import { planLimits } from '../lib/plans.js';
import { renderNotFound, siteHeader } from '../lib/kit.js';
import { invoiceId } from '../lib/invoices.js';
import { randomChallenge, toBase64Url, verifyRegistration, verifyAuthentication } from '../lib/webauthn.js';

// Ultra creators can invite one manager. Managers sign in with a passkey
// and work on the creator's dashboard, but never on billing, payouts, the
// account itself or the team.
const ROLES = { full: 'Full access', deals: 'Deals only' };
const INVITE_DAYS = 7;
const CHALLENGE_MS = 5 * 60000;

async function creator(request, env, write) {
  if (write && !sameOrigin(request)) return { response: json({ error: 'Bad origin' }, 403) };
  const user = await getSessionUser(request, env, { creatorOnly: true });
  if (!user) return { response: json({ error: 'Not signed in' }, 401) };
  if (write && !planLimits(user).ultra) return { response: json({ error: 'Manager access is part of Ultra.', locked: true }, 403) };
  return { user };
}

// The creator's team: their manager, if any, and any open invite
export async function onRequestGet({ request, env }) {
  const { user, response } = await creator(request, env, false);
  if (response) return response;
  const manager = await env.DB.prepare(`SELECT m.id, m.name, t.role, t.created_at, t.last_active_at,
      (SELECT COUNT(*) FROM passkeys p WHERE p.manager_id = m.id) AS passkeys
    FROM team_members t JOIN managers m ON m.id = t.manager_id WHERE t.creator_id = ?`).bind(user.id).first();
  const invite = await env.DB.prepare('SELECT role, expires_at FROM team_invites WHERE creator_id = ? AND expires_at > ?').bind(user.id, Date.now()).first();
  return json({
    locked: !planLimits(user).ultra,
    roles: ROLES,
    manager: manager && { name: manager.name, role: manager.role, since: manager.created_at, lastActiveAt: manager.last_active_at, passkeys: manager.passkeys },
    invite: invite && { role: invite.role, expiresAt: invite.expires_at },
  });
}

// Makes a new invite link (replacing any old one). The link is only shown now.
export async function invitePost({ request, env }) {
  const { user, response } = await creator(request, env, true);
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const role = body.role in ROLES ? body.role : 'deals';
  const existing = await env.DB.prepare('SELECT 1 FROM team_members WHERE creator_id = ?').bind(user.id).first();
  if (existing) return json({ error: 'You already have a manager. Remove them first to invite someone else.' }, 409);
  const token = randomToken();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM team_invites WHERE creator_id = ?').bind(user.id),
    env.DB.prepare('INSERT INTO team_invites (token_hash, creator_id, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(await sha256(token), user.id, role, now, now + INVITE_DAYS * 86400000),
  ]);
  return json({ ok: true, link: `${new URL(request.url).origin}/team/join/${token}` });
}

export async function inviteDelete({ request, env }) {
  const { user, response } = await creator(request, env, true);
  if (response) return response;
  await env.DB.prepare('DELETE FROM team_invites WHERE creator_id = ?').bind(user.id).run();
  return json({ ok: true });
}

// Changes the manager's role: { role }
export async function managerPut({ request, env }) {
  const { user, response } = await creator(request, env, true);
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  if (!(body.role in ROLES)) return json({ error: 'Unknown role' }, 400);
  await env.DB.prepare('UPDATE team_members SET role = ? WHERE creator_id = ?').bind(body.role, user.id).run();
  return json({ ok: true });
}

// Removes the manager. They're signed out right away. Allowed without
// Ultra, so a creator whose plan lapsed can still remove someone.
export async function managerDelete({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  const user = await getSessionUser(request, env, { creatorOnly: true });
  if (!user) return json({ error: 'Not signed in' }, 401);
  const member = await env.DB.prepare('SELECT manager_id FROM team_members WHERE creator_id = ?').bind(user.id).first();
  if (member) {
    // A manager only ever manages one creator, so their whole account goes
    await env.DB.batch([
      env.DB.prepare('DELETE FROM manager_sessions WHERE manager_id = ?').bind(member.manager_id),
      env.DB.prepare('DELETE FROM team_members WHERE manager_id = ?').bind(member.manager_id),
      env.DB.prepare('DELETE FROM passkeys WHERE manager_id = ?').bind(member.manager_id),
      env.DB.prepare('DELETE FROM managers WHERE id = ?').bind(member.manager_id),
    ]);
  }
  return json({ ok: true });
}

async function findInvite(env, token) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token || '')) return null;
  return env.DB.prepare(`SELECT i.*, u.display_name, u.slug FROM team_invites i JOIN users u ON u.id = i.creator_id
    WHERE i.token_hash = ? AND i.expires_at > ?`).bind(await sha256(token), Date.now()).first();
}

// The page a manager opens from their invite link
export async function joinPage({ request, env, params }) {
  const viewer = await getSessionUser(request, env);
  const invite = await findInvite(env, params.token);
  if (!invite) {
    return html(renderNotFound(viewer).replace(/<h1>[^<]*<\/h1>/, '<h1>This invite has expired or was already used</h1>'), 404);
  }
  return html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Join ${e(invite.display_name)}'s team · CreatorGG</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
${siteHeader(null)}
<main class="wrap auth-panel panel">
  <h1>Manage ${e(invite.display_name)} on CreatorGG</h1>
  <p class="muted">${e(invite.display_name)} invited you to help run their sponsorships, with <strong>${e(ROLES[invite.role])}</strong>${invite.role === 'deals' ? ' (deals, proposals, invoices and reports)' : ' (everything except billing and their account)'}.</p>
  <p class="muted">You'll sign in with a <strong>passkey</strong>: your phone or computer's Face ID, fingerprint or PIN. No password needed.</p>
  <form id="joinForm">
    <label>Your name <input type="text" name="name" maxlength="80" required autocomplete="name"></label>
    <button type="submit" id="joinButton">Create passkey and join</button>
  </form>
  <p class="alert alert-error" id="joinError" hidden></p>
  <p class="small muted">A passkey is saved on this device (and synced through iCloud Keychain or Google Password Manager if you use them). It only works on ${e(new URL(request.url).hostname)}.</p>
</main>
<script type="module">
  import { createPasskey } from '/passkey.js';
  const form = document.getElementById('joinForm');
  const error = document.getElementById('joinError');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('joinButton');
    button.disabled = true;
    error.hidden = true;
    try {
      await createPasskey({ token: ${JSON.stringify(params.token)}, name: form.elements.name.value });
      location.href = '/dashboard/';
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      button.disabled = false;
    }
  });
</script>
</body>
</html>`);
}

function rp(request) {
  const url = new URL(request.url);
  return { origin: url.origin, rpId: url.hostname };
}

async function saveChallenge(env, data) {
  const id = invoiceId();
  const challenge = randomChallenge();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?').bind(now),
    env.DB.prepare('INSERT INTO webauthn_challenges (id, challenge, data, expires_at) VALUES (?, ?, ?, ?)')
      .bind(id, challenge, JSON.stringify(data), now + CHALLENGE_MS),
  ]);
  return { id, challenge };
}

// Each challenge can be used once
async function takeChallenge(env, id) {
  const row = await env.DB.prepare('SELECT * FROM webauthn_challenges WHERE id = ? AND expires_at > ?').bind(String(id || ''), Date.now()).first();
  if (!row) return null;
  await env.DB.prepare('DELETE FROM webauthn_challenges WHERE id = ?').bind(row.id).run();
  return { challenge: row.challenge, data: JSON.parse(row.data) };
}

// Options for creating a passkey: from an invite { token, name }, or to add
// another device for a signed-in manager {}
export async function registerOptions({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  const body = await request.json().catch(() => ({}));
  let data;
  let user;
  if (body.token) {
    const invite = await findInvite(env, body.token);
    if (!invite) return json({ error: 'This invite has expired or was already used. Ask for a new one.' }, 400);
    const name = String(body.name ?? '').trim().slice(0, 80);
    if (!name) return json({ error: 'Enter your name.' }, 400);
    const managerId = invoiceId();
    data = { mode: 'invite', tokenHash: invite.token_hash, name, managerId };
    user = { id: managerId, name };
  } else {
    const session = await getSessionUser(request, env);
    if (!session?.manager) return json({ error: 'Sign in as a manager first.' }, 401);
    data = { mode: 'add', managerId: session.manager.id };
    user = { id: session.manager.id, name: session.manager.name };
  }
  const { id, challenge } = await saveChallenge(env, data);
  const existing = data.mode === 'add'
    ? (await env.DB.prepare('SELECT id FROM passkeys WHERE manager_id = ?').bind(data.managerId).all()).results
    : [];
  return json({
    challengeId: id,
    publicKey: {
      challenge,
      rp: { name: 'CreatorGG', id: rp(request).rpId },
      user: { id: toBase64Url(new TextEncoder().encode(user.id)), name: `${user.name} (CreatorGG manager)`, displayName: user.name },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: existing.map((p) => ({ type: 'public-key', id: p.id })),
      attestation: 'none',
      timeout: CHALLENGE_MS,
    },
  });
}

export async function registerVerify({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  const body = await request.json().catch(() => ({}));
  const pending = await takeChallenge(env, body.challengeId);
  if (!pending) return json({ error: 'That took too long. Please try again.' }, 400);
  let key;
  try {
    key = await verifyRegistration(body.response || {}, { challenge: pending.challenge, ...rp(request) });
  } catch (err) {
    return json({ error: err.message }, 400);
  }
  const now = Date.now();
  const savePasskey = (managerId) => env.DB.prepare('INSERT INTO passkeys (id, manager_id, public_key, alg, sign_count, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(key.credentialId, managerId, key.publicKey, key.alg, key.signCount, now);

  if (pending.data.mode === 'add') {
    await savePasskey(pending.data.managerId).run();
    return json({ ok: true });
  }

  // Joining from an invite: the invite is used up as the manager is created
  const invite = await env.DB.prepare('SELECT * FROM team_invites WHERE token_hash = ? AND expires_at > ?').bind(pending.data.tokenHash, now).first();
  if (!invite) return json({ error: 'This invite has expired or was already used. Ask for a new one.' }, 400);
  if (await env.DB.prepare('SELECT 1 FROM team_members WHERE creator_id = ?').bind(invite.creator_id).first()) {
    return json({ error: 'This creator already has a manager.' }, 409);
  }
  const managerId = pending.data.managerId;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM team_invites WHERE token_hash = ?').bind(invite.token_hash),
    env.DB.prepare('INSERT INTO managers (id, name, created_at) VALUES (?, ?, ?)').bind(managerId, pending.data.name, now),
    savePasskey(managerId),
    env.DB.prepare('INSERT INTO team_members (creator_id, manager_id, role, created_at, last_active_at) VALUES (?, ?, ?, ?, ?)')
      .bind(invite.creator_id, managerId, invite.role, now, now),
  ]);
  const res = json({ ok: true });
  res.headers.append('set-cookie', await createManagerSession(env, managerId, invite.creator_id));
  res.headers.append('set-cookie', clearCreatorCookie());
  return res;
}

export async function loginOptions({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  const { id, challenge } = await saveChallenge(env, { mode: 'login' });
  return json({
    challengeId: id,
    publicKey: { challenge, rpId: rp(request).rpId, userVerification: 'preferred', allowCredentials: [], timeout: CHALLENGE_MS },
  });
}

export async function loginVerify({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  const body = await request.json().catch(() => ({}));
  const pending = await takeChallenge(env, body.challengeId);
  if (!pending || pending.data.mode !== 'login') return json({ error: 'That took too long. Please try again.' }, 400);
  const passkey = await env.DB.prepare('SELECT * FROM passkeys WHERE id = ?').bind(String(body.id || '')).first();
  if (!passkey) return json({ error: "We don't recognize that passkey. If your creator removed you, ask them for a new invite." }, 400);
  let signCount;
  try {
    signCount = await verifyAuthentication(body.response || {}, passkey, { challenge: pending.challenge, ...rp(request) });
  } catch (err) {
    return json({ error: err.message }, 400);
  }
  const member = await env.DB.prepare(`SELECT t.creator_id, u.plan, u.plan_source, u.plan_expires FROM team_members t
    JOIN users u ON u.id = t.creator_id WHERE t.manager_id = ?`).bind(passkey.manager_id).first();
  if (!member) return json({ error: "You're not managing anyone right now. Ask your creator for a new invite." }, 403);
  if (!planLimits(member).ultra) return json({ error: "Manager access is paused because your creator's Ultra plan has ended." }, 403);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE id = ?').bind(signCount, now, passkey.id),
    env.DB.prepare('UPDATE team_members SET last_active_at = ? WHERE manager_id = ?').bind(now, passkey.manager_id),
  ]);
  const res = json({ ok: true });
  res.headers.append('set-cookie', await createManagerSession(env, passkey.manager_id, member.creator_id));
  res.headers.append('set-cookie', clearCreatorCookie());
  return res;
}
