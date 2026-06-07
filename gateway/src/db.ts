// SQLite 初始化：建 clients + pairing_codes 表 + 索引 + 设置 PRAGMA user_version。
// 启动时调一次：openDatabase(GATEWAY_DB_PATH) → 拿到 db 实例。
// v3 schema_version = 1，未来加表时递增 user_version + 加 migration。
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS clients (
  id           TEXT PRIMARY KEY,
  key_hash     TEXT NOT NULL UNIQUE,
  name         TEXT,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  meta         TEXT
);
CREATE INDEX IF NOT EXISTS idx_clients_last_seen ON clients(last_seen_at);

CREATE TABLE IF NOT EXISTS pairing_codes (
  token       TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  client_name TEXT,
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pairing_codes_expires ON pairing_codes(expires_at);
`;

const CURRENT_USER_VERSION = 1;

export function openDatabase(path: string): DatabaseType {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);

  // migration: 若 user_version < CURRENT，跑升级
  const row = db.pragma('user_version') as Array<{ user_version: number }>;
  const current = row[0]?.user_version ?? 0;
  if (current < CURRENT_USER_VERSION) {
    // v3 阶段没有 migration 步骤（schema 直接写在 SCHEMA_SQL）
    db.pragma(`user_version = ${CURRENT_USER_VERSION}`);
  }
  return db;
}
