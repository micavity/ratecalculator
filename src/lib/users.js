import { REGION_MULTIPLIER, FOCUS_MULTIPLIER } from '../../public/rates.js';
import { twitchAppToken, getTwitchStats, twitchConfigured } from './twitch.js';
import { getYouTubeStats, youtubeConfigured } from './youtube.js';
import {
  THEMES, ESSENTIAL_THEMES, KIT_STYLES, isHexColor, normalizeSections, parseRateCard, parsePackages,
  parseFeatured, parseBrands, parseAudience, brandsToText, parseJson,
} from './kit-content.js';
import { withVideoStats } from './video-stats.js';
import { PLAN_RANK, effectivePlan, planLimits } from './plans.js';
import { SOCIALS, SOCIAL_COLUMNS, cleanHandle } from './socials.js';

// Paths that can't be used as media kit links
export const RESERVED_SLUGS = new Set([
  'about', 'admin', 'affiliate', 'affiliates', 'api', 'app', 'assets', 'auth', 'blog', 'brands', 'calculator',
  'book', 'contact', 'creatorgg', 'faq', 'features', 'guides', 'home', 'vendor',
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

// Per-creator tables, besides users, connections and sessions
export const USER_DATA_TABLES = ['kit_views', 'kit_sources', 'kit_countries', 'link_events', 'tracked_links', 'kit_versions', 'stat_snapshots', 'deals', 'invoices', 'proposals', 'booking_slots'];

// Profile fields copied from the merged-away profile when the kept one is empty
const MERGE_FIELDS = [
  'avatar_url', 'bio', 'games', 'game_art', 'contact_email', 'twitch_avg_viewers', 'invoice_settings',
  'booking', 'tiktok_handle', 'tiktok_followers', 'tiktok_avg_views', 'tiktok_engagement',
  ...SOCIAL_COLUMNS,
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

  // Keep the better plan, so a paid or gifted plan is never lost
  if (PLAN_RANK[effectivePlan(drop)] > PLAN_RANK[effectivePlan(keep)]) {
    statements.push(env.DB.prepare('UPDATE users SET plan = ?, plan_source = ?, plan_expires = ? WHERE id = ?')
      .bind(drop.plan, drop.plan_source, drop.plan_expires, keep.id));
  }
  if (drop.gift_plan && PLAN_RANK[drop.gift_plan] > PLAN_RANK[keep.gift_plan || 'free']) {
    statements.push(env.DB.prepare('UPDATE users SET gift_plan = ?, gift_expires = ? WHERE id = ?')
      .bind(drop.gift_plan, drop.gift_expires, keep.id));
  }
  // Keep a paying subscription and referral credit from either profile
  if (drop.stripe_subscription_id && !keep.stripe_subscription_id) {
    statements.push(env.DB.prepare(`UPDATE users SET stripe_customer_id = ?, stripe_subscription_id = ?, subscription_status = ?,
      subscription_interval = ?, cancel_at_period_end = ?, first_paid_at = COALESCE(first_paid_at, ?) WHERE id = ?`)
      .bind(drop.stripe_customer_id, drop.stripe_subscription_id, drop.subscription_status, drop.subscription_interval,
        drop.cancel_at_period_end, drop.first_paid_at, keep.id));
  }
  if (drop.referred_by && !keep.referred_by && drop.referred_by !== keep.id) {
    statements.push(env.DB.prepare('UPDATE users SET referred_by = ? WHERE id = ?').bind(drop.referred_by, keep.id));
  }
  statements.push(env.DB.prepare('UPDATE users SET referred_by = ? WHERE referred_by = ?').bind(keep.id, drop.id));
  statements.push(env.DB.prepare('UPDATE commissions SET referrer_id = ? WHERE referrer_id = ?').bind(keep.id, drop.id));
  statements.push(env.DB.prepare('UPDATE commissions SET referred_id = ? WHERE referred_id = ?').bind(keep.id, drop.id));

  if (drop.founding && !keep.founding) {
    statements.push(env.DB.prepare('UPDATE users SET founding = 1 WHERE id = ?').bind(keep.id));
  }

  // Deals are the creator's own records, so they move over. Their tracked
  // links are deleted below, so deals stop pointing at them.
  statements.push(env.DB.prepare('UPDATE deals SET user_id = ?, link_id = NULL WHERE user_id = ?').bind(keep.id, drop.id));
  statements.push(env.DB.prepare('UPDATE invoices SET user_id = ? WHERE user_id = ?').bind(keep.id, drop.id));
  statements.push(env.DB.prepare('UPDATE proposals SET user_id = ? WHERE user_id = ?').bind(keep.id, drop.id));
  statements.push(env.DB.prepare('UPDATE booking_slots SET user_id = ? WHERE user_id = ?').bind(keep.id, drop.id));

  // Analytics, links and versions on the merged-away profile go with it
  for (const table of USER_DATA_TABLES) {
    statements.push(env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(drop.id));
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
  return { userId: id, merged: false, created: true };
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

  const { results: versions } = await env.DB.prepare('SELECT id, overrides FROM kit_versions WHERE user_id = ?').bind(userId).all();
  for (const version of versions) {
    const overrides = parseJson(version.overrides, {});
    const videos = overrides.featured || [];
    if (!videos.some((v) => !v.statsUpdatedAt || Date.now() - v.statsUpdatedAt >= maxAge)) continue;
    overrides.featured = await withVideoStats(env, videos);
    await env.DB.prepare('UPDATE kit_versions SET overrides = ? WHERE id = ? AND overrides = ?')
      .bind(JSON.stringify(overrides), version.id, version.overrides).run();
    refreshed = true;
  }
  return refreshed;
}

// Refreshes creators whose stats are over a day old, oldest first.
// Limited per run to stay well within API quotas.
export async function refreshStaleUsers(env, limit = 50) {
  const { results } = await env.DB.prepare(
    `SELECT user_id, MIN(COALESCE(stats_updated_at, 0)) AS oldest FROM connections
     GROUP BY user_id HAVING oldest < ? ORDER BY oldest LIMIT ?`,
  ).bind(Date.now() - STALE_MS, limit).all();
  for (const row of results) {
    await refreshStats(env, row.user_id).catch((err) => console.error('Scheduled refresh failed:', err.message));
  }
}

// The fields a creator can edit, as sent to the dashboard
export function profileFields(user) {
  return {
    slug: user.slug,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    bio: user.bio,
    games: user.games,
    gameArt: parseJson(user.game_art, []),
    contactEmail: user.contact_email,
    region: user.region,
    focus: user.focus,
    showRates: Boolean(user.show_rates),
    autoFeatured: Boolean(user.auto_featured),
    twitchAvgViewers: user.twitch_avg_viewers,
    twitchHours: user.twitch_hours,
    tiktokHandle: user.tiktok_handle,
    tiktokFollowers: user.tiktok_followers,
    tiktokAvgViews: user.tiktok_avg_views,
    tiktokEngagement: user.tiktok_engagement,
    ...Object.fromEntries(SOCIALS.flatMap((s) => [
      [`${s.field}Handle`, user[`${s.key}_handle`]],
      [`${s.field}Followers`, user[`${s.key}_followers`]],
      [`${s.field}AvgViews`, user[`${s.key}_avg_views`]],
      [`${s.field}Engagement`, user[`${s.key}_engagement`]],
    ])),
    featured: parseJson(user.featured, []).map((v) => v.url),
    brands: brandsToText(parseJson(user.brands, [])),
    audience: parseJson(user.audience, {}),
    theme: user.theme,
    rateMode: user.rate_mode,
    rateCard: parseJson(user.rate_card, []),
    packages: parseJson(user.packages, []),
    hideBranding: Boolean(user.hide_branding),
    sections: normalizeSections(parseJson(user.sections, [])),
    kitStyle: user.kit_style,
    accent: user.accent,
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
  values.auto_featured = body.autoFeatured ? 1 : 0;

  const numbers = [
    ['twitch_avg_viewers', 'twitchAvgViewers', { min: 0, max: 10_000_000, integer: true }],
    ['tiktok_followers', 'tiktokFollowers', { min: 0, max: 1_000_000_000, integer: true }],
    ['tiktok_avg_views', 'tiktokAvgViews', { min: 0, max: 1_000_000_000, integer: true }],
    ['tiktok_engagement', 'tiktokEngagement', { min: 0, max: 100 }],
    ...SOCIALS.flatMap((s) => [
      [`${s.key}_followers`, `${s.field}Followers`, { min: 0, max: 5_000_000_000, integer: true }],
      [`${s.key}_avg_views`, `${s.field}AvgViews`, { min: 0, max: 5_000_000_000, integer: true }],
      [`${s.key}_engagement`, `${s.field}Engagement`, { min: 0, max: 100 }],
    ]),
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
  for (const s of SOCIALS) {
    const handle = cleanHandle(body[`${s.field}Handle`]);
    if (handle && !s.handle.test(handle)) return fail(`${s.field}Handle`, `Enter a valid ${s.name} username.`);
    values[`${s.key}_handle`] = handle;
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

  values.theme = body.theme in THEMES || body.theme in ESSENTIAL_THEMES ? body.theme : 'purple';

  // Essential settings
  values.rate_mode = body.rateMode === 'custom' ? 'custom' : 'estimates';
  const rateCard = parseRateCard(body.rateCard);
  if (rateCard.error) return fail('rateCard', rateCard.error);
  values.rate_card = JSON.stringify(rateCard.value);
  const packages = parsePackages(body.packages);
  if (packages.error) return fail('packages', packages.error);
  values.packages = JSON.stringify(packages.value);
  values.hide_branding = body.hideBranding ? 1 : 0;
  values.sections = JSON.stringify(normalizeSections(body.sections));
  values.kit_style = KIT_STYLES.includes(body.kitStyle) ? body.kitStyle : 'auto';
  values.accent = isHexColor(body.accent) ? body.accent.toLowerCase() : '';

  return { values };
}

const ESSENTIAL_COLUMNS = ['rate_mode', 'rate_card', 'packages', 'hide_branding', 'sections', 'kit_style', 'accent'];

/**
 * Applies plan limits to validated profile values. Settings the creator's
 * plan doesn't include are left out, so whatever was saved before stays
 * as it was. Returns { values } or { error, field }.
 */
export function applyPlanLimits(values, user) {
  const limits = planLimits(user);
  // Videos beyond the limit are allowed only if they're unchanged from
  // before, e.g. after a plan lapses. They're kept but not shown.
  const key = (v) => `${v.type}:${v.id}`;
  const extra = JSON.parse(values.featured).slice(limits.featured).map(key);
  const savedExtra = parseJson(user.featured, []).slice(limits.featured).map(key);
  if (extra.length && extra.join() !== savedExtra.join()) {
    return {
      field: 'featured',
      error: `Your plan includes up to ${limits.featured} featured videos.${limits.essential ? '' : ' Essential includes 6.'}`,
    };
  }
  const allowed = { ...values };
  // Ultra settings stay as they were on other plans
  if (!limits.ultra) delete allowed.auto_featured;
  if (limits.essential) return { values: allowed };

  for (const column of ESSENTIAL_COLUMNS) delete allowed[column];
  if (allowed.theme in ESSENTIAL_THEMES) delete allowed.theme;
  return { values: allowed };
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
  for (const s of SOCIALS) {
    if (user[`${s.key}_followers`] || user[`${s.key}_avg_views`]) platforms.push(s.key);
  }
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
    ...Object.fromEntries(SOCIALS.flatMap((s) => [
      [`${s.rateKey}Followers`, user[`${s.key}_followers`]],
      [`${s.rateKey}Views`, user[`${s.key}_avg_views`]],
      [`${s.rateKey}Engagement`, user[`${s.key}_engagement`]],
    ])),
  };
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
