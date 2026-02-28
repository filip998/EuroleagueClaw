CREATE TABLE IF NOT EXISTS tracked_games (
  id TEXT PRIMARY KEY,
  game_code INTEGER NOT NULL,
  season_code TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  last_score_home INTEGER DEFAULT 0,
  last_score_away INTEGER DEFAULT 0,
  last_quarter INTEGER DEFAULT 0,
  last_event_id TEXT,
  tracked_by_chat_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_subscriptions (
  chat_id TEXT PRIMARY KEY,
  chat_platform TEXT NOT NULL DEFAULT 'telegram',
  is_active INTEGER DEFAULT 1,
  muted_until TEXT,
  fantasy_enabled INTEGER DEFAULT 0,
  trivia_enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  game_id TEXT,
  event_type TEXT NOT NULL,
  event_key TEXT NOT NULL,
  message_text TEXT NOT NULL,
  sent_at TEXT DEFAULT (datetime('now')),
  UNIQUE(chat_id, event_key)
);

CREATE TABLE IF NOT EXISTS trivia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT,
  last_used_at TEXT
);
