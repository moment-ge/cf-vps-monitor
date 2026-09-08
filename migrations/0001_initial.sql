PRAGMA foreign_keys = ON;
CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL);
INSERT INTO settings VALUES (1, '{}');
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'US',
  group_name TEXT NOT NULL DEFAULT '默认分组',
  visible INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CNY',
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  expires_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL DEFAULT 0,
  metrics TEXT,
  alert_state TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE history (
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  metrics TEXT NOT NULL,
  PRIMARY KEY(node_id, ts)
) WITHOUT ROWID;
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX events_created ON events(created_at);
CREATE TABLE login_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL);
