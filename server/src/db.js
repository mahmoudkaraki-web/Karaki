// The family's data: one SQLite file in the data folder (node:sqlite, no native build).
// Ticks are kept as two marks per member per chat (delivered up to, read up to), the way
// big messengers do it: one row update per receipt instead of one row per message.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS members (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  apple_sub   TEXT UNIQUE,
  is_admin    INTEGER NOT NULL DEFAULT 0,
  color       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  removed_at  INTEGER
);

CREATE TABLE IF NOT EXISTS devices (
  id          INTEGER PRIMARY KEY,
  member_id   INTEGER NOT NULL REFERENCES members(id),
  token_hash  TEXT NOT NULL UNIQUE,
  label       TEXT,
  push_token  TEXT,
  voip_token  TEXT,              -- phase 2: PushKit token for ringing calls
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  revoked_at  INTEGER
);

CREATE TABLE IF NOT EXISTS invites (
  id          INTEGER PRIMARY KEY,
  code_hash   TEXT NOT NULL UNIQUE,
  created_by  INTEGER REFERENCES members(id),
  name_hint   TEXT,
  is_admin    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_by     INTEGER REFERENCES members(id),
  used_at     INTEGER,
  revoked_at  INTEGER,
  for_member  INTEGER REFERENCES members(id)  -- a sign in code for an existing member's new phone
);

CREATE TABLE IF NOT EXISTS chats (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
  title       TEXT,
  direct_key  TEXT UNIQUE,       -- "lowId:highId" so two people only ever have one direct chat
  created_by  INTEGER NOT NULL REFERENCES members(id),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id         INTEGER NOT NULL REFERENCES chats(id),
  member_id       INTEGER NOT NULL REFERENCES members(id),
  joined_at       INTEGER NOT NULL,
  left_at         INTEGER,
  delivered_up_to INTEGER NOT NULL DEFAULT 0,
  read_up_to      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, member_id)
);

CREATE TABLE IF NOT EXISTS media (
  id          TEXT PRIMARY KEY,  -- random, also the file name on disk
  owner_id    INTEGER NOT NULL REFERENCES members(id),
  kind        TEXT NOT NULL CHECK (kind IN ('photo', 'voice')),
  mime        TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  duration_ms INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id     INTEGER NOT NULL REFERENCES chats(id),
  sender_id   INTEGER REFERENCES members(id),  -- NULL for system lines ("Sara added Omar")
  kind        TEXT NOT NULL CHECK (kind IN ('text', 'photo', 'voice', 'system', 'call')),
  body        TEXT,              -- for 'call' lines: JSON { callId, kind, outcome, seconds }
  media_id    TEXT REFERENCES media(id),
  client_id   TEXT,              -- the phone's own id, so a resend never makes a double
  created_at  INTEGER NOT NULL
);

-- calls (phase 2 and 3): one row per call, one row per member asked or joining
CREATE TABLE IF NOT EXISTS calls (
  id          TEXT PRIMARY KEY,  -- a UUID: the same id CallKit uses on every phone
  chat_id     INTEGER NOT NULL REFERENCES chats(id),
  kind        TEXT NOT NULL CHECK (kind IN ('voice', 'video')),
  started_by  INTEGER NOT NULL REFERENCES members(id),
  created_at  INTEGER NOT NULL,
  answered_at INTEGER,
  ended_at    INTEGER,
  end_reason  TEXT               -- ended, missed, declined, busy, cancelled
);

CREATE TABLE IF NOT EXISTS call_members (
  call_id     TEXT NOT NULL REFERENCES calls(id),
  member_id   INTEGER NOT NULL REFERENCES members(id),
  state       TEXT NOT NULL CHECK (state IN ('ringing', 'joined', 'left', 'declined', 'missed', 'busy')),
  device_id   INTEGER,           -- the phone that joined, so signalling goes to that phone only
  joined_at   INTEGER,
  left_at     INTEGER,
  PRIMARY KEY (call_id, member_id)
);

CREATE INDEX IF NOT EXISTS calls_open ON calls(chat_id) WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS messages_by_chat ON messages(chat_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS messages_client ON messages(sender_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_members_by_member ON chat_members(member_id);
CREATE INDEX IF NOT EXISTS devices_by_member ON devices(member_id);
`;

// quiet, warm colours for each member's initial seal; given out in this order
export const MEMBER_COLORS = ['#B4532A', '#3F6B5C', '#5B5F97', '#9A6B1F', '#7A4E6E', '#2F6690', '#8C5A3C', '#4F7A3A'];

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'media'), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'family.sqlite'));
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// columns added after the first install: added in place, data kept
function migrate(db) {
  const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  if (!has('invites', 'for_member')) db.exec('ALTER TABLE invites ADD COLUMN for_member INTEGER REFERENCES members(id)');
}

// small helpers so the routes read plainly
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function one(db, sql, ...args) {
  return db.prepare(sql).get(...args);
}

export function all(db, sql, ...args) {
  return db.prepare(sql).all(...args);
}

export function run(db, sql, ...args) {
  return db.prepare(sql).run(...args);
}
