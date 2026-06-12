// SQLite 初始化：建 4 张表 + 索引 + 写 schema_version=4。
// v6.3.1: bump 1→2（新增 agents.context_window 字段）。
// v6.3.2: bump 2→3（新增 agents.reasoning_effort 字段）。
// v6.4: bump 3→4（新增 agents.api_key 字段）。
// 启动时调一次：openDatabase(CORE_DB_PATH) → 拿到 db 实例。
// 参考 gateway/src/db.ts 的 WAL + foreign_keys PRAGMA 模式。
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// v6.1 = 1；v6.3.1 加 context_window → 2；v6.3.2 加 reasoning_effort → 3；v6.4 加 api_key → 4。
const SCHEMA_VERSION = 4;

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
    // 区分两种情况：
    // 1) 全新空库 → schema.sql + 写 version=1
    // 2) DB 里已有任意表但 schema_version 缺失 → 损坏的旧库，不迁移，loud fail
    const anyTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1").get();
    if (anyTable) {
      throw new Error('schema version mismatch: schema_version table missing in non-empty DB');
    }
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
