// Database migrations, applied automatically on the first request after a
// deploy. Add new steps to the end; never edit or reorder existing ones.
export const MIGRATIONS = [
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
  // 3: plans, Essential kit features, detailed analytics, tracked links, kit versions
  [
    "ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'",
    "ALTER TABLE users ADD COLUMN plan_source TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE users ADD COLUMN plan_expires INTEGER',
    'ALTER TABLE users ADD COLUMN founding INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE users ADD COLUMN rate_mode TEXT NOT NULL DEFAULT 'estimates'",
    "ALTER TABLE users ADD COLUMN rate_card TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE users ADD COLUMN packages TEXT NOT NULL DEFAULT '[]'",
    'ALTER TABLE users ADD COLUMN hide_branding INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE users ADD COLUMN sections TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE users ADD COLUMN kit_style TEXT NOT NULL DEFAULT 'auto'",
    "ALTER TABLE users ADD COLUMN accent TEXT NOT NULL DEFAULT ''",
    `CREATE TABLE IF NOT EXISTS kit_sources (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      source TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day, source)
    )`,
    `CREATE TABLE IF NOT EXISTS kit_countries (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      country TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day, country)
    )`,
    `CREATE TABLE IF NOT EXISTS kit_versions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      overrides TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (user_id, key)
    )`,
    `CREATE TABLE IF NOT EXISTS tracked_links (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      version_id TEXT,
      opens INTEGER NOT NULL DEFAULT 0,
      last_opened_at INTEGER,
      created_at INTEGER NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS tracked_links_user ON tracked_links(user_id)',
    `CREATE TABLE IF NOT EXISTS link_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      at INTEGER NOT NULL,
      country TEXT NOT NULL DEFAULT ''
    )`,
    'CREATE INDEX IF NOT EXISTS link_events_user ON link_events(user_id, at)',
  ],
  // 4: Stripe subscriptions, referrals and commissions
  [
    'ALTER TABLE users ADD COLUMN stripe_customer_id TEXT',
    'ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT',
    "ALTER TABLE users ADD COLUMN subscription_status TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE users ADD COLUMN subscription_interval TEXT',
    'ALTER TABLE users ADD COLUMN cancel_at_period_end INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN referral_code TEXT',
    'ALTER TABLE users ADD COLUMN referred_by TEXT',
    'ALTER TABLE users ADD COLUMN first_paid_at INTEGER',
    "ALTER TABLE users ADD COLUMN payout_email TEXT NOT NULL DEFAULT ''",
    'CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS users_stripe_customer ON users(stripe_customer_id)',
    'CREATE INDEX IF NOT EXISTS users_referred_by ON users(referred_by)',
    `CREATE TABLE IF NOT EXISTS commissions (
      id TEXT PRIMARY KEY,
      referrer_id TEXT NOT NULL,
      referred_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      commission_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      available_at INTEGER NOT NULL,
      paid_at INTEGER
    )`,
    'CREATE INDEX IF NOT EXISTS commissions_referrer ON commissions(referrer_id, status)',
    'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  ],
  // 5: daily stat snapshots for growth charts
  [
    `CREATE TABLE IF NOT EXISTS stat_snapshots (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      platform TEXT NOT NULL,
      followers INTEGER,
      avg_views INTEGER,
      PRIMARY KEY (user_id, platform, day)
    )`,
  ],
  // 6: Pro deal tracker, and gifts remembered separately from paid plans
  // so a gift comes back when a paid subscription ends
  [
    `CREATE TABLE IF NOT EXISTS deals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      brand TEXT NOT NULL,
      website TEXT,
      contact_name TEXT,
      contact_email TEXT,
      stage TEXT NOT NULL,
      amount_cents INTEGER,
      currency TEXT NOT NULL DEFAULT 'USD',
      deliverables TEXT,
      due_date TEXT,
      payment_due TEXT,
      paid_on TEXT,
      notes TEXT,
      link_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS deals_user ON deals (user_id, updated_at)',
    'ALTER TABLE users ADD COLUMN gift_plan TEXT',
    'ALTER TABLE users ADD COLUMN gift_expires INTEGER',
    "UPDATE users SET gift_plan = plan, gift_expires = plan_expires WHERE plan_source = 'gift'",
  ],
  // 7: self-reported Instagram, Facebook and X stats
  ['instagram', 'facebook', 'x'].flatMap((p) => [
    `ALTER TABLE users ADD COLUMN ${p}_handle TEXT`,
    `ALTER TABLE users ADD COLUMN ${p}_followers INTEGER`,
    `ALTER TABLE users ADD COLUMN ${p}_avg_views INTEGER`,
    `ALTER TABLE users ADD COLUMN ${p}_engagement REAL`,
  ]),
  // 8: Twitch box art matched to the games a creator lists
  ['ALTER TABLE users ADD COLUMN game_art TEXT'],
  // 9: Pro invoices, and each creator's saved invoice details
  [
    `CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      deal_id TEXT,
      number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unpaid',
      issued_on TEXT NOT NULL,
      due_on TEXT,
      paid_on TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      sender TEXT NOT NULL,
      bill_to TEXT NOT NULL,
      items TEXT NOT NULL,
      tax_rate REAL,
      tax_label TEXT,
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS invoices_user ON invoices (user_id, created_at)',
    'CREATE INDEX IF NOT EXISTS invoices_deal ON invoices (deal_id)',
    'ALTER TABLE users ADD COLUMN invoice_settings TEXT',
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
