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
  // 10: Pro proposals that brands can accept or ask to change
  [
    `CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      deal_id TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      title TEXT NOT NULL,
      brand TEXT NOT NULL,
      contact_name TEXT,
      contact_email TEXT,
      items TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      timeline TEXT,
      includes TEXT,
      message TEXT,
      valid_until TEXT,
      view_count INTEGER NOT NULL DEFAULT 0,
      first_viewed_at INTEGER,
      last_viewed_at INTEGER,
      responder_name TEXT,
      responder_email TEXT,
      change_note TEXT,
      responded_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS proposals_user ON proposals (user_id, created_at)',
    'CREATE INDEX IF NOT EXISTS proposals_deal ON proposals (deal_id)',
  ],
  // 11: Ultra auto-featured videos
  ['ALTER TABLE users ADD COLUMN auto_featured INTEGER NOT NULL DEFAULT 0'],
  // 12: Ultra "Book me" page: settings, and the open dates brands can request
  [
    'ALTER TABLE users ADD COLUMN booking TEXT',
    `CREATE TABLE IF NOT EXISTS booking_slots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      kind TEXT NOT NULL,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      deal_id TEXT,
      created_at INTEGER NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS booking_slots_user ON booking_slots (user_id, day)',
  ],
  // 13: Ultra campaign reports with live stats for brands
  [
    `CREATE TABLE IF NOT EXISTS campaign_reports (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      deal_id TEXT,
      brand TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      clicks INTEGER,
      conversions INTEGER,
      summary TEXT,
      stats_updated_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS campaign_reports_user ON campaign_reports (user_id, created_at)',
    'CREATE INDEX IF NOT EXISTS campaign_reports_stale ON campaign_reports (stats_updated_at)',
  ],
  // 14: Ultra manager access, signed in with passkeys
  [
    `CREATE TABLE IF NOT EXISTS managers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS passkeys (
      id TEXT PRIMARY KEY,
      manager_id TEXT NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
      public_key TEXT NOT NULL,
      alg INTEGER NOT NULL,
      sign_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    )`,
    'CREATE INDEX IF NOT EXISTS passkeys_manager ON passkeys (manager_id)',
    `CREATE TABLE IF NOT EXISTS team_members (
      creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      manager_id TEXT NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_active_at INTEGER,
      PRIMARY KEY (creator_id, manager_id)
    )`,
    'CREATE INDEX IF NOT EXISTS team_members_manager ON team_members (manager_id)',
    `CREATE TABLE IF NOT EXISTS team_invites (
      token_hash TEXT PRIMARY KEY,
      creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS manager_sessions (
      token_hash TEXT PRIMARY KEY,
      manager_id TEXT NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
      creator_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS webauthn_challenges (
      id TEXT PRIMARY KEY,
      challenge TEXT NOT NULL,
      data TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )`,
  ],
  // 15: Essential: stats the creator chose to hide from their kit
  ['ALTER TABLE users ADD COLUMN hidden_stats TEXT'],
  // 16: Essential: which stats each kit card shows (up to 6 per platform)
  ['ALTER TABLE users ADD COLUMN shown_stats TEXT'],
  // 17: Ultra business tools: expenses, tax set-aside and seasonal pricing
  [
    'ALTER TABLE users ADD COLUMN business TEXT',
    `CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      created_at INTEGER NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS expenses_user ON expenses (user_id, day)',
  ],
  // 18: reviews from creators, and when to ask them
  [
    `CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL,
      comment TEXT,
      public_ok INTEGER NOT NULL DEFAULT 0,
      approved INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS reviews_user ON reviews (user_id, created_at)',
    'ALTER TABLE users ADD COLUMN review_snooze_until INTEGER',
    "ALTER TABLE users ADD COLUMN review_opt_out INTEGER NOT NULL DEFAULT 0",
  ],
  // 19: Pro: show a growth line on the kit
  ['ALTER TABLE users ADD COLUMN show_growth INTEGER NOT NULL DEFAULT 0'],
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
