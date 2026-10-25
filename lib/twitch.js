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

async function requestToken(body) {
  const res = await fetch(TOKEN_URL, { method: 'POST', body: new URLSearchParams(body) });
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

// App token for refreshing public stats without the creator's own token
export function twitchAppToken(env) {
  return requestToken({
    client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET,
    grant_type: 'client_credentials',
  });
}

async function helix(env, token, path) {
  const res = await fetch(`${API}${path}`, {
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
