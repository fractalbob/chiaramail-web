// PostgreSQL: the tables, created on start if missing. Message content is
// stored exactly as the sender's app sent it: for ECS messages that is
// ciphertext (subject, body, attachment names), unreadable here.
import pg from 'pg';

// int8 (bigint) as JS numbers: byte counts stay far below 2^53.
pg.types.setTypeParser(20, (v) => Number(v));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  uid         text PRIMARY KEY,
  email       text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sign_in_codes (
  email       text PRIMARY KEY,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sign_in_log (
  email       text NOT NULL,
  ip          text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sign_in_log_at ON sign_in_log (at);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  text PRIMARY KEY,
  uid         text NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  used_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS prefs (
  uid         text PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
  signature   text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS usage (
  uid         text PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
  bytes       bigint NOT NULL DEFAULT 0 CHECK (bytes >= 0)
);
CREATE TABLE IF NOT EXISTS ecs_users (
  email       text PRIMARY KEY,
  since       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS messages (
  id            text PRIMARY KEY,
  sender_uid    text NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  sender_email  text NOT NULL,
  sender_name   text,
  recipients    text[] NOT NULL,
  subject       text NOT NULL,
  body          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  edition       int NOT NULL DEFAULT 1,
  withdrawn     boolean NOT NULL DEFAULT false,
  allow_forward boolean NOT NULL DEFAULT false,
  attachments   jsonb,
  enc           int,
  counted       boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS messages_sender ON messages (sender_uid);
CREATE INDEX IF NOT EXISTS messages_recipients ON messages USING gin (recipients);
CREATE TABLE IF NOT EXISTS editions (
  message_id  text NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  edition     int NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL,
  saved_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, edition)
);
-- Attachments can change with an edition: each file has a slot (its file name
-- on disk); each edition records its list; files of earlier editions are kept
-- for the sender's record (and still count against their allowance).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS next_slot int;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS stored_bytes bigint;
ALTER TABLE editions ADD COLUMN IF NOT EXISTS attachments jsonb;
CREATE TABLE IF NOT EXISTS reads (
  message_id    text NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  email         text NOT NULL,
  last_read_at  timestamptz NOT NULL DEFAULT now(),
  edition_seen  int NOT NULL,
  PRIMARY KEY (message_id, email)
);
`;

export async function openDb(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  await pool.query(SCHEMA);
  return {
    pool,
    query: (text, params) => pool.query(text, params),
    /** Runs fn(client) in one transaction. */
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await fn(c);
        await c.query('COMMIT');
        return r;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { c.release(); }
    },
    close: () => pool.end(),
  };
}
