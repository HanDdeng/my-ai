// SQLite 初始化：建 4 张表 + 索引 + 写 schema_version=SCHEMA_VERSION。
// v6.3.1: bump 1→2（新增 agents.context_window 字段）。
// v6.3.2: bump 2→3（新增 agents.reasoning_effort 字段）。
// v6.4:   bump 3→4（新增 agents.api_key 字段）。
// v6.5:   bump 4→5（解除 max_tokens ≤32000 上限） + 引入渐进 migration runner。
// 启动时调一次：openDatabase(CORE_DB_PATH) → 拿到 db 实例。
// 参考 gateway/src/db.ts 的 WAL + foreign_keys PRAGMA 模式。
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';
import { MIGRATION_4_TO_5_SQL } from './migrations/v4-to-v5.js';

// v6.1 = 1；v6.3.1 加 context_window → 2；v6.3.2 加 reasoning_effort → 3；v6.4 加 api_key → 4；
// v6.5 解除 max_tokens 上限 → 5。
const SCHEMA_VERSION = 5;

// v6.5: 渐进 migration runner。MIGRATIONS[N] 把 schema_version=N 升到 N+1。
//   每个 entry 用 better-sqlite3 db 执行对应 migrations/v(N)-to-v(N+1).ts 的内联 SQL。
//   顺序由 openDatabase 内的 for-loop 串行应用（cur → SCHEMA_VERSION）。
const MIGRATIONS: Record<number, (db: DatabaseType) => void> = {
  4: db => {
    db.exec(MIGRATION_4_TO_5_SQL);
  },
};

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
    // 1) 全新空库 → schema.sql + 写 version=SCHEMA_VERSION
    // 2) DB 里已有任意表但 schema_version 缺失 → 损坏的旧库，不迁移，loud fail
    const anyTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1").get();
    if (anyTable) {
      throw new Error('schema version mismatch: schema_version table missing in non-empty DB');
    }
    // 首启动：执行 schema.sql + 写 version=SCHEMA_VERSION
    db.exec(SCHEMA_SQL);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      SCHEMA_VERSION,
      new Date().toISOString(),
    );
  } else {
    // 后续启动：检查 version；不符 → 尝试 migration 升级或 loud fail
    const row = db.prepare('SELECT version FROM schema_version').get() as
      | { version: number }
      | undefined;
    const cur = row?.version;
    if (cur === undefined) {
      throw new Error('schema version mismatch: schema_version row missing in existing table');
    }
    if (cur > SCHEMA_VERSION) {
      // 二进制比 DB 旧 → loud fail（降级风险）
      throw new Error(
        `schema version mismatch: DB ${cur} > expected ${SCHEMA_VERSION}; downgrade unsafe`,
      );
    }
    // 顺序应用 cur → SCHEMA_VERSION 的所有 migration
    for (let v = cur; v < SCHEMA_VERSION; v++) {
      const m = MIGRATIONS[v];
      if (!m) {
        throw new Error(`missing migration ${v} → ${v + 1}`);
      }
      try {
        m(db);
      } catch (e) {
        // 显式回滚 + 提示用户。begin 之后若语句失败，better-sqlite3 不会自动回滚，
        // 留下半成品 agents_new + 原 agents + schema_version 旧值 = 死锁状态。
        try {
          db.exec('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw new Error(
          `migration ${v} → ${v + 1} failed: ${e instanceof Error ? e.message : String(e)}; DB is in partial state, manual cleanup required`,
        );
      }
    }
  }

  return db;
}
