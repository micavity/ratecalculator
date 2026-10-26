import { REGION_MULTIPLIER, FOCUS_MULTIPLIER } from '../../public/rates.js';
import { twitchAppToken, getTwitchStats, twitchConfigured } from './twitch.js';
import { getYouTubeStats, youtubeConfigured } from './youtube.js';
import { THEMES, parseFeatured, parseBrands, parseAudience, brandsToText, parseJson } from './kit-content.js';
import { withVideoStats } from './video-stats.js';

// Paths that can't be used as media kit links
export const RESERVED_SLUGS = new Set([
  'about', 'admin', 'api', 'app', 'assets', 'auth', 'blog', 'brands', 'contact', 'creatorgg',
  'dashboard', 'help', 'index', 'kit', 'login', 'logout', 'pricing', 'privacy', 'settings',
  'signup', 'static', 'support', 'terms', 'u', 'www',
]);

const SLUG_PATTERN = /^[a-z0-9_-]{3,30}$/;
const STALE_MS = 24 * 3600 * 1000;
const MANUAL_REFRESH_MS = 10 * 60 * 1000;

export function isValidSlug(slug) {
  return SLUG_PATTERN.test(slug) && !RESERVED_SLUGS.has(slug);
}

function slugBase(hint) {
  const base = String(hint || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '')
    .slice(0, 24);
  return base.length >= 3 && !RESERVED_SLUGS.has(base) ? base : 'creator';
}

async function uniqueSlug(env, hint) {
  const base = slugBase(hint);
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}${Math.floor(Math.random() * 9000) + 1000}`;
    const taken = await env.DB.prepare('SELECT 1 FROM users WHERE slug = ?').bind(candidate).first();
    if (!taken && isValidSlug(candidate)) return candidate;
  }
  return `creator${crypto.randomUUID().slice(0, 8)}`;
}

function saveConnection(env, userId, provider, account, stats) {
  return env.DB.prepare(
    `INSERT INTO connections (provider, provider_id, user_id, username, url, avatar_url, stats, stats_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (provider, provider_id) DO UPDATE SET
       user_id = excluded.user_id, username = excluded.username, url = excluded.url,
       avatar_url = excluded.avatar_url, stats = excluded.stats, stats_updated_at = excluded.stats_updated_at`,
  ).bind(
    provider, account.providerId, userId, account.username, account.url,
    account.avatarUrl, JSON.stringify(stats), Date.now(),
  );
}

// Profile fields copied from the merged-away profile when the kept one is empty
const MERGE_FIELDS = [
  'avatar_url', 'bio', 'games', 'contact_email', 'twitch_avg_viewers',
  'tiktok_handle', 'tiktok_followers', 'tiktok_avg_views', 'tiktok_engagement',
];

/**
 * Combines two profiles when a creator links an account that already
 * belongs to another profile. Signing in with that account proves they
 * own the other profile too. The older profile is kept; the account being
 * linked replaces any other account on the same platform, and for other
 * platforms the kept profile's accounts win. Returns the kept user ID.
 */
async function mergeUsers(env, aId, bId, provider, account, stats) {
  const [a, b] = await Promise.all([aId, bId].map((id) =>
    env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first()));
  const [keep, drop] = a.created_at <= b.created_at ? [a, b] : [b, a];
  const keepConnections = await getConnections(env, keep.id);
  const dropConnections = await getConnections(env, drop.id);

  const statements = [
    env.DB.prepare('DELETE FROM connections WHERE user_id IN (?, ?) AND provider = ? AND provider_id != ?')
      .bind(keep.id, drop.id, provider, account.providerId),
  ];
  for (const [p, conn] of Object.entries(dropConnections)) {
    if (p === provider) continue;
    statements.push(keepConnections[p]
      ? env.DB.prepare('DELETE FROM connections WHERE provider = ? AND provider_id = ?').bind(p, conn.providerId)
      : env.DB.prepare('UPDATE connections SET user_id = ? WHERE provider = ? AND provider_id = ?').bind(keep.id, p, conn.providerId));
  }
  statements.push(saveConnection(env, keep.id, provider, account, stats));

  const fill = MERGE_FIELDS.filter((f) => (keep[f] === null || keep[f] === '') && drop[f] !== null && drop[f] !== '');
  if (fill.length) {
    statements.push(env.DB.prepare(`UPDATE users SET ${fill.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...fill.map((f) => drop[f]), Date.now(), keep.id));
  }

  // Keep the creator signed in, now on the kept profile
  statements.push(env.DB.prepare('UPDATE sessions SET user_id = ? WHERE user_id = ?').bind(keep.id, drop.id));
  statements.push(env.DB.prepare('DELETE FROM users WHERE id = ?').bind(drop.id));
  await env.DB.batch(statements);
  return keep.id;
}

/**
 * Signs in with a provider account, creating a user if needed.
 * If currentUser is set, links the account to that user instead, merging
 * profiles if the account already belongs to another one.
 * Returns { userId, merged }.
 */
export async function signInWithAccount(env, provider, account, stats, currentUser) {
  const existing = await env.DB.prepare(
    'SELECT user_id FROM connections WHERE provider = ? AND provider_id = ?',
  ).bind(provider, account.providerId).first();

  if (currentUser) {
    if (existing && existing.user_id !== currentUser.id) {
      const userId = await mergeUsers(env, currentUser.id, existing.user_id, provider, account, stats);
      return { userId, merged: true };
    }
    // One account per platform: replace any other linked account
    await env.DB.batch([
      env.DB.prepare('DELETE FROM connections WHERE user_id = ? AND provider = ? AND provider_id != ?')
        .bind(currentUser.id, provider, account.providerId),
      saveConnection(env, currentUser.id, provider, account, stats),
    ]);
    if (!currentUser.avatar_url && account.avatarUrl) {
      await env.DB.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(account.avatarUrl, currentUser.id).run();
    }
    return { userId: currentUser.id, merged: false };
  }

  if (existing) {
    await saveConnection(env, existing.user_id, provider, account, stats).run();
    return { userId: existing.user_id, merged: false };
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, slug, display_name, avatar_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id, await uniqueSlug(env, account.slugHint), account.username.slice(0, 60), account.avatarUrl, now, now),
    saveConnection(env, id, provider, account, stats),
  ]);
  return { userId: id, merged: false };
}

export async function getConnections(env, userId) {
  const { results } = await env.DB.prepare(
    'SELECT provider, provider_id, username, url, avatar_url, stats, stats_updated_at FROM connections WHERE user_id = ?',
  ).bind(userId).all();
  const connections = {};
  for (const row of results) {
    connections[row.provider] = {
      providerId: row.provider_id,
      username: row.username,
      url: row.url,
      avatarUrl: row.avatar_url,
      stats: JSON.parse(row.stats || '{}'),
      statsUpdatedAt: row.stats_updated_at,
    };
  }
  return connections;
}

/**
 * Re-fetches stats for a user's linked accounts. Manual refreshes are
 * limited to once every 10 minutes; automatic ones to once a day.
 * Returns true if anything was refreshed.
 */
export async function refreshStats(env, userId, { manual = false } = {}) {
  const maxAge = manual ? MANUAL_REFRESH_MS : STALE_MS;
  const connections = await getConnections(env, userId);
  let refreshed = false;

  for (const [provider, conn] of Object.entries(connections)) {
    if (conn.statsUpdatedAt && Date.now() - conn.statsUpdatedAt < maxAge) continue;
    try {
      let stats;
      if (provider === 'twitch' && twitchConfigured(env)) {
        stats = await getTwitchStats(env, await twitchAppToken(env), conn.providerId);
      } else if (provider === 'youtube' && youtubeConfigured(env)) {
        stats = await getYouTubeStats(conn.providerId, { key: env.YOUTUBE_API_KEY });
      } else {
        continue;
      }
      await env.DB.prepare(
        'UPDATE connections SET stats = ?, stats_updated_at = ? WHERE provider = ? AND provider_id = ?',
      ).bind(JSON.stringify(stats), Date.now(), provider, conn.providerId).run();
      refreshed = true;
    } catch (err) {
      console.error(`Stats refresh failed for ${provider}:`, err.message);
    }
  }

  const user = await env.DB.prepare('SELECT featured FROM users WHERE id = ?').bind(userId).first();
  const featured = parseJson(user?.featured, []);
  if (featured.some((v) => !v.statsUpdatedAt || Date.now() - v.statsUpdatedAt >= maxAge)) {
    const updated = await withVideoStats(env, featured);
    // Only touch videos the creator hasn't changed since we read them
    await env.DB.prepare('UPDATE users SET featured = ? WHERE id = ? AND featured = ?')
      .bind(JSON.stringify(updated), userId, user.featured).run();
    refreshed = true;
  }
  return refreshed;
}

// The fields a creator can edit, as sent to the dashboard
export function profileFields(user) {
  return {
    slug: user.slug,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    bio: user.bio,
    games: user.games,
    contactEmail: user.contact_email,
    region: user.region,
    focus: user.focus,
    showRates: Boolean(user.show_rates),
    twitchAvgViewers: user.twitch_avg_viewers,
    twitchHours: user.twitch_hours,
    tiktokHandle: user.tiktok_handle,
    tiktokFollowers: user.tiktok_followers,
    tiktokAvgViews: user.tiktok_avg_views,
    tiktokEngagement: user.tiktok_engagement,
    featured: parseJson(user.featured, []).map((v) => v.url),
    brands: brandsToText(parseJson(user.brands, [])),
    audience: parseJson(user.audience, {}),
    theme: user.theme,
  };
}

function optionalNumber(value, { min, max, integer }) {
  if (value === null || value === undefined || value === '') return { value: null };
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return { error: true };
  return { value: integer ? Math.round(n) : Math.round(n * 10) / 10 };
}

function text(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

/**
 * Validates profile edits. Returns { values } or { error, field }.
 */
export function validateProfile(body) {
  const values = {};
  const fail = (field, error) => ({ field, error });

  const slug = text(body.slug, 30).toLowerCase();
  if (!SLUG_PATTERN.test(slug)) return fail('slug', 'Use 3–30 letters, numbers, dashes or underscores.');
  if (RESERVED_SLUGS.has(slug)) return fail('slug', 'That link is reserved. Try another.');
  values.slug = slug;

  values.display_name = text(body.displayName, 60);
  if (!values.display_name) return fail('displayName', 'Enter a display name.');

  values.bio = text(body.bio, 500);
  values.games = text(body.games, 200);

  values.contact_email = text(body.contactEmail, 254);
  if (values.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.contact_email)) {
    return fail('contactEmail', 'Enter a valid email address.');
  }

  values.region = body.region in REGION_MULTIPLIER ? body.region : 'mixed';
  values.focus = body.focus in FOCUS_MULTIPLIER ? body.focus : 'gaming';
  values.show_rates = body.showRates ? 1 : 0;

  const numbers = [
    ['twitch_avg_viewers', 'twitchAvgViewers', { min: 0, max: 10_000_000, integer: true }],
    ['tiktok_followers', 'tiktokFollowers', { min: 0, max: 1_000_000_000, integer: true }],
    ['tiktok_avg_views', 'tiktokAvgViews', { min: 0, max: 1_000_000_000, integer: true }],
    ['tiktok_engagement', 'tiktokEngagement', { min: 0, max: 100 }],
  ];
  for (const [column, field, limits] of numbers) {
    const result = optionalNumber(body[field], limits);
    if (result.error) return fail(field, 'Enter a valid number.');
    values[column] = result.value;
  }

  const hours = optionalNumber(body.twitchHours, { min: 0.5, max: 24 });
  if (hours.error) return fail('twitchHours', 'Enter between 0.5 and 24 hours.');
  values.twitch_hours = hours.value ?? 3;

  values.tiktok_handle = text(body.tiktokHandle, 30).replace(/^@/, '');
  if (values.tiktok_handle && !/^[A-Za-z0-9_.]{2,24}$/.test(values.tiktok_handle)) {
    return fail('tiktokHandle', 'Enter a valid TikTok username.');
  }

  const featured = parseFeatured(body.featured);
  if (featured.error) return fail('featured', featured.error);
  values.featured = JSON.stringify(featured.value);

  const brands = parseBrands(body.brands);
  if (brands.error) return fail('brands', brands.error);
  values.brands = JSON.stringify(brands.value);

  const audience = parseAudience(body.audience);
  if (audience.error) return fail('audience', audience.error);
  values.audience = JSON.stringify(audience.value);

  values.theme = body.theme in THEMES ? body.theme : 'purple';

  return { values };
}

export async function updateProfile(env, userId, values) {
  const columns = Object.keys(values);
  const assignments = columns.map((c) => `${c} = ?`).join(', ');
  await env.DB.prepare(`UPDATE users SET ${assignments}, updated_at = ? WHERE id = ?`)
    .bind(...columns.map((c) => values[c]), Date.now(), userId)
    .run();
}

// Turns a user + linked accounts into rate calculator input
export function rateInput(user, connections) {
  const platforms = [];
  if (user.twitch_avg_viewers) platforms.push('twitch');
  if (connections.youtube) platforms.push('youtube');
  if (user.tiktok_avg_views) platforms.push('tiktok');
  const yt = connections.youtube?.stats || {};
  return {
    platforms,
    region: user.region,
    focus: user.focus,
    twitchViewers: user.twitch_avg_viewers,
    twitchHours: user.twitch_hours,
    ytViews: yt.avgViews,
    ytShortsViews: yt.avgShortsViews,
    ytEngagement: yt.engagement,
    ttViews: user.tiktok_avg_views,
    ttEngagement: user.tiktok_engagement,
  };
}

const BOT_PATTERN = /bot|crawl|spider|preview|discord|slack|facebookexternalhit|twitter|whatsapp|telegram|embed|curl|wget|python/i;

// Counts a media kit view, skipping bots, link previews and the creator themselves
export async function recordView(env, request, ownerId, viewer) {
  if (viewer?.id === ownerId) return;
  if (BOT_PATTERN.test(request.headers.get('user-agent') || '')) return;
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(
    `INSERT INTO kit_views (user_id, day, views) VALUES (?, ?, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET views = views + 1`,
  ).bind(ownerId, day).run();
}

export async function getViewStats(env, userId) {
  const since = (days) => new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const row = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN day >= ? THEN views END), 0) AS last7,
       COALESCE(SUM(CASE WHEN day >= ? THEN views END), 0) AS last30,
       COALESCE(SUM(views), 0) AS total
     FROM kit_views WHERE user_id = ?`,
  ).bind(since(7), since(30), userId).first();
  return { last7: row.last7, last30: row.last30, total: row.total };
}
