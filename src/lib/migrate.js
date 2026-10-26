// Database migrations, applied automatically on the first request after a
// deploy. Add new steps to the end; never edit or reorder existing ones.
const MIGRATIONS = [
  // 1: initial tables
  [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      bio TEXT NOT NULL DEFAULT '',
      games TEXT NOT NULL DEFAULT '',
      contact_email TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT 'mixed',
      focus TEXT NOT NULL DEFAULT 'gaming',
      show_rates INTEGER NOT NULL DEFAULT 1,
      twitch_avg_viewers INTEGER,
      twitch_hours REAL NOT NULL DEFAULT 3,
      tiktok_handle TEXT NOT NULL DEFAULT '',
      tiktok_followers INTEGER,
      tiktok_avg_views INTEGER,
      tiktok_engagement REAL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS connections (
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      url TEXT NOT NULL,
      avatar_url TEXT,
      stats TEXT NOT NULL DEFAULT '{}',
      stats_updated_at INTEGER,
      PRIMARY KEY (provider, provider_id)
    )`,
    'CREATE INDEX IF NOT EXISTS connections_user ON connections(user_id)',
    `CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    )`,
  ],
  // 2: richer media kits and view counts
  [
    "ALTER TABLE users ADD COLUMN featured TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE users ADD COLUMN brands TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE users ADD COLUMN audience TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'purple'",
    `CREATE TABLE IF NOT EXISTS kit_views (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day)
    )`,
  ],
];

let ready = null;

async function migrate(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)').run();
  const row = await env.DB.prepare('SELECT MAX(version) AS version FROM schema_version').first();
  let version = row?.version ?? 0;

  while (version < MIGRATIONS.length) {
    for (const sql of MIGRATIONS[version]) {
      try {
        await env.DB.prepare(sql).run();
      } catch (err) {
        // Another request may have applied this step at the same moment
        if (!/duplicate column|already exists/i.test(err.message)) throw err;
      }
    }
    version += 1;
    await env.DB.prepare('INSERT INTO schema_version (version) VALUES (?)').bind(version).run();
  }
}

// Runs migrations once per Worker instance
export function ensureSchema(env) {
  if (!ready) {
    ready = migrate(env).catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}
