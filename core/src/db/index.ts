// SQLite 初始化：建 4 张表 + 索引 + 写 schema_version=1。
// 启动时调一次：openDatabase(CORE_DB_PATH) → 拿到 db 实例。
// 参考 gateway/src/db.ts 的 WAL + foreign_keys PRAGMA 模式。
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = 1;

function loadSchemaSql(): string {
  // schema.sql 与本文件同目录：src/db/schema.sql
  // 编译后：dist/db/schema.sql（tsc 保留目录结构）
  // 用 import.meta.url 锚定路径
  const url = new URL('./schema.sql', import.meta.url);
  return readFileSync(fileURLToPath(url), 'utf8');
}

export function openDatabase(path: string): DatabaseType {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 检查 schema_version 表是否已存在
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
    .get();

  if (!tableExists) {
    // 首启动：执行 schema.sql + 写 version=1
    db.exec(loadSchemaSql());
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      SCHEMA_VERSION,
      new Date().toISOString(),
    );
  } else {
    // 后续启动：检查 version=1；不符 → 抛错（loud fail）
    const row = db.prepare('SELECT version FROM schema_version').get() as
      | { version: number }
      | undefined;
    if (!row || row.version !== SCHEMA_VERSION) {
      throw new Error(
        `schema version mismatch: expected ${SCHEMA_VERSION}, got ${row?.version ?? 'missing'}`,
      );
    }
  }

  return db;
}
