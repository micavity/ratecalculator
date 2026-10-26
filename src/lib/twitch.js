// Twitch sign-in and stats. Sign-in asks for no extra permissions:
// it only proves the creator owns the channel.
const AUTH_URL = 'https://id.twitch.tv/oauth2/authorize';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const API = 'https://api.twitch.tv/helix';

export function twitchConfigured(env) {
  return Boolean(env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET);
}

export function twitchAuthorizeUrl(env, redirectUri, state) {
  const params = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: '',
    state,
    force_verify: 'true',
  });
  return `${AUTH_URL}?${params}`;
}

async function requestToken(body, env) {
  // TWITCH_TOKEN_URL and TWITCH_API_BASE can point at a test server locally
  const res = await fetch(env?.TWITCH_TOKEN_URL || TOKEN_URL, { method: 'POST', body: new URLSearchParams(body) });
  if (!res.ok) throw new Error(`Twitch token request failed (${res.status})`);
  return (await res.json()).access_token;
}

export function exchangeTwitchCode(env, code, redirectUri) {
  return requestToken({
    client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
}

// App token for public lookups without the creator's own token. Kept for
// an hour per Worker instance, since game suggestions look up as people type.
let appToken = null;

export function twitchAppToken(env) {
  if (appToken && appToken.expires > Date.now()) return appToken.token;
  const token = requestToken({
    client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET,
    grant_type: 'client_credentials',
  }, env);
  appToken = { token, expires: Date.now() + 3600000 };
  token.catch(() => { appToken = null; });
  return token;
}

async function helix(env, token, path) {
  const res = await fetch(`${env.TWITCH_API_BASE || API}${path}`, {
    headers: { authorization: `Bearer ${token}`, 'client-id': env.TWITCH_CLIENT_ID },
  });
  if (!res.ok) throw new Error(`Twitch API ${path} failed (${res.status})`);
  return res.json();
}

export async function getTwitchUser(env, token) {
  const { data } = await helix(env, token, '/users');
  const user = data?.[0];
  if (!user) throw new Error('Twitch returned no user');
  return {
    providerId: user.id,
    username: user.display_name || user.login,
    url: `https://twitch.tv/${user.login}`,
    avatarUrl: user.profile_image_url || null,
    slugHint: user.login,
  };
}

// Without extra scopes Twitch still returns the follower total
export async function getTwitchStats(env, token, broadcasterId) {
  const data = await helix(env, token, `/channels/followers?broadcaster_id=${encodeURIComponent(broadcasterId)}&first=1`);
  return { followers: data.total ?? 0 };
}

// Public clip and VOD details, looked up by ID
export async function getTwitchClips(env, token, ids) {
  if (!ids.length) return [];
  const query = ids.map((id) => `id=${encodeURIComponent(id)}`).join('&');
  return (await helix(env, token, `/clips?${query}`)).data || [];
}

export async function getTwitchVideos(env, token, ids) {
  if (!ids.length) return [];
  const query = ids.map((id) => `id=${encodeURIComponent(id)}`).join('&');
  return (await helix(env, token, `/videos?${query}`)).data || [];
}

// Games and their box art. Twitch also has non-game categories (Just
// Chatting, Music, Sports…); those have no IGDB ID, and we leave them out
// so topics like "music" stay plain text on kits.
function gameFields(g) {
  return { id: g.id, name: g.name, art: g.box_art_url || '' };
}

async function realGames(env, token, ids) {
  if (!ids.length) return [];
  const query = ids.map((id) => `id=${encodeURIComponent(id)}`).join('&');
  return ((await helix(env, token, `/games?${query}`)).data || []).filter((g) => g.igdb_id).map(gameFields);
}

export async function getGamesByName(env, token, names) {
  if (!names.length) return [];
  const query = names.map((n) => `name=${encodeURIComponent(n)}`).join('&');
  return ((await helix(env, token, `/games?${query}`)).data || []).filter((g) => g.igdb_id).map(gameFields);
}

export async function searchGames(env, token, query, first = 8) {
  const { data } = await helix(env, token, `/search/categories?query=${encodeURIComponent(query)}&first=${first}`);
  const ids = (data || []).map((c) => c.id);
  const games = await realGames(env, token, ids);
  // Keep Twitch's ordering (best match first)
  return ids.map((id) => games.find((g) => g.id === id)).filter(Boolean);
}
