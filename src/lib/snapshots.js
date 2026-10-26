// Daily stat snapshots, so Pro can show growth over time. One row per
// creator, platform and day. YouTube's API rules don't allow keeping its
// data for more than 30 days, so YouTube rows are deleted after 30 days;
// Twitch and creator-entered TikTok numbers are kept.
const YOUTUBE_KEEP_DAYS = 30;

function today(now) {
  return new Date(now).toISOString().slice(0, 10);
}

async function alreadyDone(env, day) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'snapshot_day'").first();
  return row?.value === day;
}

export async function takeSnapshots(env, now = Date.now()) {
  const day = today(now);
  if (await alreadyDone(env, day)) return 0;

  const [{ results: connections }, { results: tiktok }] = await Promise.all([
    env.DB.prepare('SELECT user_id, provider, stats FROM connections').all(),
    env.DB.prepare('SELECT id, tiktok_followers, tiktok_avg_views FROM users WHERE tiktok_followers IS NOT NULL OR tiktok_avg_views IS NOT NULL').all(),
  ]);

  const rows = [];
  for (const c of connections) {
    const stats = JSON.parse(c.stats || '{}');
    if (c.provider === 'twitch' && stats.followers != null) rows.push([c.user_id, 'twitch', stats.followers, null]);
    if (c.provider === 'youtube' && (stats.subscribers != null || stats.avgViews != null)) {
      rows.push([c.user_id, 'youtube', stats.subscribers ?? null, stats.avgViews ?? null]);
    }
  }
  for (const u of tiktok) rows.push([u.id, 'tiktok', u.tiktok_followers, u.tiktok_avg_views]);

  const insert = `INSERT INTO stat_snapshots (user_id, day, platform, followers, avg_views) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id, platform, day) DO UPDATE SET followers = excluded.followers, avg_views = excluded.avg_views`;
  for (let i = 0; i < rows.length; i += 50) {
    await env.DB.batch(rows.slice(i, i + 50).map(([userId, platform, followers, avgViews]) =>
      env.DB.prepare(insert).bind(userId, day, platform, followers, avgViews)));
  }

  const cutoff = today(now - YOUTUBE_KEEP_DAYS * 86400000);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM stat_snapshots WHERE platform = 'youtube' AND day < ?").bind(cutoff),
    env.DB.prepare("INSERT INTO settings (key, value) VALUES ('snapshot_day', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(day),
  ]);
  return rows.length;
}
