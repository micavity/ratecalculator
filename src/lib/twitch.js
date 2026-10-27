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

// Without extra scopes Twitch still returns the follower total. Also keeps
// the most-viewed clips of the last 28 days, for Ultra's auto-featured videos.
export async function getTwitchStats(env, token, broadcasterId) {
  const id = encodeURIComponent(broadcasterId);
  const since = new Date(Date.now() - 28 * 86400000).toISOString();
  const none = { data: [] };
  const [followers, clips, users, vods] = await Promise.all([
    helix(env, token, `/channels/followers?broadcaster_id=${id}&first=1`),
    helix(env, token, `/clips?broadcaster_id=${id}&started_at=${encodeURIComponent(since)}&first=6`).catch(() => none),
    helix(env, token, `/users?id=${id}`).catch(() => none),
    helix(env, token, `/videos?user_id=${id}&type=archive&first=20`).catch(() => none),
  ]);
  const topClips = (clips.data || [])
    .map((c) => ({ id: c.id, title: c.title || '', views: c.view_count ?? 0, publishedAt: c.created_at || null, url: c.url }))
    .sort((a, b) => b.views - a.views);
  const user = users.data?.[0];
  return { followers: followers.total ?? 0, topClips, ...pastStreamStats(vods.data || []), broadcasterType: user?.broadcaster_type || '', since: user?.created_at || null };
}

// "3h2m10s" → hours
function durationHours(text) {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text || '');
  if (!m) return 0;
  return (Number(m[1]) || 0) + (Number(m[2]) || 0) / 60 + (Number(m[3]) || 0) / 3600;
}

// Average views, length and how often they stream, from saved past
// broadcasts. Twitch keeps these 7 to 60 days, so the window adapts.
export function pastStreamStats(vods, now = Date.now()) {
  if (!vods.length) return { avgVodViews: null, streamLengthHours: null, streamsPerWeek: null };
  const avg = (list) => list.reduce((s, v) => s + v, 0) / list.length;
  const recent = vods.filter((v) => now - Date.parse(v.created_at) <= 28 * 86400000);
  const oldest = Math.min(...recent.map((v) => Date.parse(v.created_at)));
  const weeks = recent.length ? Math.min(4, Math.max(1, (now - oldest) / (7 * 86400000))) : 1;
  return {
    avgVodViews: Math.round(avg(vods.map((v) => v.view_count || 0))),
    streamLengthHours: Math.round(avg(vods.map((v) => durationHours(v.duration))) * 10) / 10 || null,
    streamsPerWeek: recent.length ? Math.round((recent.length / weeks) * 10) / 10 : null,
  };
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

// Whether a channel is live right now. Kept for 2 minutes per Worker
// instance, so busy kits don't ask Twitch on every view.
const liveCache = new Map();
const LIVE_CACHE_MS = 120000;

export async function getLiveStream(env, broadcasterId) {
  const cached = liveCache.get(broadcasterId);
  if (cached && cached.at > Date.now() - LIVE_CACHE_MS) return cached.stream;
  const { data } = await helix(env, await twitchAppToken(env), `/streams?user_id=${encodeURIComponent(broadcasterId)}`);
  const s = data?.[0];
  const stream = s?.type === 'live' ? { game: s.game_name || '', title: s.title || '', viewers: s.viewer_count ?? null } : null;
  if (liveCache.size > 5000) liveCache.clear();
  liveCache.set(broadcasterId, { at: Date.now(), stream });
  return stream;
}
