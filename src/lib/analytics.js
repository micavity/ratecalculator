// Media kit analytics. We count views per day, where visitors came from
// (the referring site, grouped) and their country (from Cloudflare). We
// never store IP addresses or who a visitor is.

const BOT_PATTERN = /bot|crawl|spider|preview|discord|slack|facebookexternalhit|twitter|whatsapp|telegram|embed|curl|wget|python/i;

// Order matters: the first match wins (e.g. Gmail counts as email, not Google)
const SOURCES = [
  [/^(mail|inbox|outlook)\.|^outlook\.live\.com$|proton\.me$|mail\.yahoo\.com$/, 'Email'],
  [/(^|\.)(x|twitter)\.com$|^t\.co$/, 'X / Twitter'],
  [/(^|\.)discord(app)?\.com$|^discord\.gg$/, 'Discord'],
  [/(^|\.)youtube\.com$|^youtu\.be$/, 'YouTube'],
  [/(^|\.)twitch\.tv$/, 'Twitch'],
  [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)reddit\.com$/, 'Reddit'],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, 'LinkedIn'],
  [/(^|\.)facebook\.com$|^fb\.com$/, 'Facebook'],
  [/(^|\.)google\.[a-z.]+$/, 'Google'],
  [/(^|\.)bing\.com$|(^|\.)duckduckgo\.com$|search\.yahoo\.com$/, 'Other search'],
];

export function sourceFromReferrer(referrer, ownHost) {
  let host;
  try {
    host = new URL(referrer).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return 'Direct';
  }
  if (host === ownHost.replace(/^www\./, '')) return 'CreatorGG';
  for (const [pattern, label] of SOURCES) {
    if (pattern.test(host)) return label;
  }
  return host.slice(0, 60);
}

export function isBot(request) {
  return BOT_PATTERN.test(request.headers.get('user-agent') || '');
}

/**
 * Records one kit view, skipping bots, link previews and the creator
 * themselves. `linkId` is a tracked brand link's code, if the visitor
 * came through one.
 */
export async function recordVisit(env, request, ownerId, viewer, linkId) {
  if (viewer?.id === ownerId || isBot(request)) return;

  const url = new URL(request.url);
  const day = new Date().toISOString().slice(0, 10);
  const country = /^[A-Z]{2}$/.test(request.cf?.country || '') ? request.cf.country : 'Unknown';
  const source = sourceFromReferrer(request.headers.get('referer') || '', url.hostname);

  const statements = [
    env.DB.prepare(`INSERT INTO kit_views (user_id, day, views) VALUES (?, ?, 1)
      ON CONFLICT (user_id, day) DO UPDATE SET views = views + 1`).bind(ownerId, day),
    env.DB.prepare(`INSERT INTO kit_sources (user_id, day, source, views) VALUES (?, ?, ?, 1)
      ON CONFLICT (user_id, day, source) DO UPDATE SET views = views + 1`).bind(ownerId, day, source),
    env.DB.prepare(`INSERT INTO kit_countries (user_id, day, country, views) VALUES (?, ?, ?, 1)
      ON CONFLICT (user_id, day, country) DO UPDATE SET views = views + 1`).bind(ownerId, day, country),
  ];

  if (linkId) {
    const now = Date.now();
    const link = await env.DB.prepare('SELECT id FROM tracked_links WHERE id = ? AND user_id = ?').bind(linkId, ownerId).first();
    if (link) {
      statements.push(
        env.DB.prepare('UPDATE tracked_links SET opens = opens + 1, last_opened_at = ? WHERE id = ?').bind(now, linkId),
        env.DB.prepare('INSERT INTO link_events (link_id, user_id, at, country) VALUES (?, ?, ?, ?)').bind(linkId, ownerId, now, country),
      );
    }
  }
  await env.DB.batch(statements);
}

function since(days) {
  return new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
}

export async function getAnalytics(env, userId, days) {
  const from = since(days);
  const [daily, sources, countries, links, recent] = await Promise.all([
    env.DB.prepare('SELECT day, views FROM kit_views WHERE user_id = ? AND day >= ? ORDER BY day').bind(userId, from).all(),
    env.DB.prepare(`SELECT source AS label, SUM(views) AS views FROM kit_sources
      WHERE user_id = ? AND day >= ? GROUP BY source ORDER BY views DESC LIMIT 8`).bind(userId, from).all(),
    env.DB.prepare(`SELECT country AS label, SUM(views) AS views FROM kit_countries
      WHERE user_id = ? AND day >= ? GROUP BY country ORDER BY views DESC LIMIT 8`).bind(userId, from).all(),
    getTrackedLinks(env, userId),
    env.DB.prepare(`SELECT e.at, e.country, l.label FROM link_events e JOIN tracked_links l ON l.id = e.link_id
      WHERE e.user_id = ? ORDER BY e.at DESC LIMIT 15`).bind(userId).all(),
  ]);

  // Fill in days with no views so charts have no gaps
  const byDay = new Map(daily.results.map((r) => [r.day, r.views]));
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    series.push({ day, views: byDay.get(day) || 0 });
  }

  return { days, daily: series, sources: sources.results, countries: countries.results, links, recent: recent.results };
}

export async function getTrackedLinks(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT l.id, l.label, l.version_id AS versionId, l.opens, l.last_opened_at AS lastOpenedAt, l.created_at AS createdAt,
            v.key AS versionKey, v.name AS versionName
     FROM tracked_links l LEFT JOIN kit_versions v ON v.id = l.version_id
     WHERE l.user_id = ? ORDER BY l.created_at DESC`,
  ).bind(userId).all();
  return results;
}

// Keeps per-visit link history from growing forever
export async function pruneOldEvents(env) {
  await env.DB.prepare('DELETE FROM link_events WHERE at < ?').bind(Date.now() - 180 * 86400000).run();
}
