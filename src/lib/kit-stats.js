// The stats a kit can show on each platform card. Every card shows up to
// MAX_STATS. Free kits always show the defaults (topped up with other stats
// when one has no data); Essential and up pick their own.
import { SOCIALS } from './socials.js';

export const MAX_STATS = 6;

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : compact.format(Number(v)));
const year = (iso) => (iso ? String(new Date(iso).getUTCFullYear()) : null);
const pct = (v) => (v === null || v === undefined ? null : `${v}%`);
const SELF = 'Self-reported';

// [key, label, value(user, connections), note]
export const STAT_DEFS = {
  twitch: [
    ['followers', 'Followers', (u, c) => num(c.twitch?.stats.followers)],
    ['avgViewers', 'Avg viewers', (u) => num(u.twitch_avg_viewers), SELF],
    ['avgVodViews', 'Avg views / past stream', (u, c) => num(c.twitch?.stats.avgVodViews)],
    ['streamsPerWeek', 'Streams', (u, c) => (c.twitch?.stats.streamsPerWeek ? `${c.twitch.stats.streamsPerWeek} / week` : null)],
    ['streamLength', 'Avg stream length', (u, c) => (c.twitch?.stats.streamLengthHours ? `${c.twitch.stats.streamLengthHours} hrs` : null)],
    ['since', 'Streaming since', (u, c) => year(c.twitch?.stats.since)],
  ],
  youtube: [
    ['subscribers', 'Subscribers', (u, c) => num(c.youtube?.stats.subscribers)],
    ['avgViews', 'Avg views / video', (u, c) => num(c.youtube?.stats.avgViews)],
    ['avgShorts', 'Avg views / Short', (u, c) => num(c.youtube?.stats.avgShortsViews)],
    ['engagement', 'Engagement', (u, c) => pct(c.youtube?.stats.engagement)],
    ['totalViews', 'Total views', (u, c) => num(c.youtube?.stats.totalViews || null)],
    ['uploadsPerMonth', 'Uploads', (u, c) => (c.youtube?.stats.uploadsPerMonth ? `${c.youtube.stats.uploadsPerMonth} / month` : null)],
    ['avgLikes', 'Avg likes / video', (u, c) => num(c.youtube?.stats.avgLikes)],
    ['avgComments', 'Avg comments / video', (u, c) => num(c.youtube?.stats.avgComments)],
    ['videoCount', 'Videos posted', (u, c) => num(c.youtube?.stats.videoCount || null)],
    ['avgLiveViews', 'Avg live stream views', (u, c) => num(c.youtube?.stats.avgLiveViews)],
    ['since', 'Creating since', (u, c) => year(c.youtube?.stats.since)],
  ],
  tiktok: [
    ['followers', 'Followers', (u) => num(u.tiktok_followers), SELF],
    ['avgViews', 'Avg views', (u) => num(u.tiktok_avg_views), SELF],
    ['engagement', 'Engagement', (u) => pct(u.tiktok_engagement), SELF],
  ],
  ...Object.fromEntries(SOCIALS.map((s) => [s.key, [
    ['followers', 'Followers', (u) => num(u[`${s.key}_followers`]), SELF],
    ['avgViews', s.viewsLabel, (u) => num(u[`${s.key}_avg_views`]), SELF],
    ['engagement', 'Engagement', (u) => pct(u[`${s.key}_engagement`]), SELF],
  ]])),
};

export const DEFAULT_STATS = {
  twitch: ['followers', 'avgViewers', 'avgVodViews', 'streamsPerWeek', 'streamLength', 'since'],
  youtube: ['subscribers', 'avgViews', 'avgShorts', 'engagement', 'totalViews', 'uploadsPerMonth'],
  tiktok: ['followers', 'avgViews', 'engagement'],
  ...Object.fromEntries(SOCIALS.map((s) => [s.key, ['followers', 'avgViews', 'engagement']])),
};

export const STAT_KEYS = Object.entries(STAT_DEFS).flatMap(([platform, defs]) => defs.map(([key]) => `${platform}.${key}`));

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The keys a creator picked, or null to use the defaults. Earlier "hide"
// choices are turned into picks.
export function chosenStats(user, essential) {
  if (!essential) return null;
  const shown = parse(user.shown_stats);
  if (Array.isArray(shown)) return shown;
  const hidden = parse(user.hidden_stats);
  if (Array.isArray(hidden) && hidden.length) {
    return Object.entries(DEFAULT_STATS).flatMap(([p, keys]) => keys.map((k) => `${p}.${k}`)).filter((k) => !hidden.includes(k));
  }
  return null;
}

/**
 * The stats to show on one platform's card: [{ key, label, value, note }].
 * Defaults are topped up with other stats that have data; picks are shown as chosen.
 */
export function cardStats(platform, user, connections, chosen) {
  const defs = STAT_DEFS[platform] || [];
  const withValue = (key) => {
    const def = defs.find(([k]) => k === key);
    const value = def ? def[2](user, connections) : null;
    return value === null ? null : { key: `${platform}.${key}`, label: def[1], value, note: def[3] };
  };
  if (chosen) {
    return chosen.filter((k) => k.startsWith(`${platform}.`)).map((k) => withValue(k.slice(platform.length + 1))).filter(Boolean).slice(0, MAX_STATS);
  }
  const order = [...DEFAULT_STATS[platform], ...defs.map(([k]) => k).filter((k) => !DEFAULT_STATS[platform].includes(k))];
  return order.map(withValue).filter(Boolean).slice(0, MAX_STATS);
}

// Checks a creator's picks: known keys, at most MAX_STATS per platform
export function readChosenStats(list) {
  const keys = [...new Set((Array.isArray(list) ? list : []).filter((k) => STAT_KEYS.includes(k)))];
  for (const platform of Object.keys(STAT_DEFS)) {
    if (keys.filter((k) => k.startsWith(`${platform}.`)).length > MAX_STATS) {
      return { error: `Pick up to ${MAX_STATS} stats for each platform.` };
    }
  }
  return { value: keys };
}
