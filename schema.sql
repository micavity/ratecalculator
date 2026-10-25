-- CreatorGG database schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS users (
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
  -- Twitch doesn't share average viewers, so creators enter it
  twitch_avg_viewers INTEGER,
  twitch_hours REAL NOT NULL DEFAULT 3,
  -- TikTok's API is restricted, so TikTok stats are entered by hand
  tiktok_handle TEXT NOT NULL DEFAULT '',
  tiktok_followers INTEGER,
  tiktok_avg_views INTEGER,
  tiktok_engagement REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Linked Twitch / YouTube accounts. Also used for sign-in.
CREATE TABLE IF NOT EXISTS connections (
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  url TEXT NOT NULL,
  avatar_url TEXT,
  stats TEXT NOT NULL DEFAULT '{}',
  stats_updated_at INTEGER,
  PRIMARY KEY (provider, provider_id)
);

CREATE INDEX IF NOT EXISTS connections_user ON connections(user_id);

-- Only a hash of the session token is stored
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
