import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase } from '@/db/index.js';

describe('openDatabase schema_version 异常', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'core-db-'));
    dbPath = join(dir, 'core.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('表存在但 schema_version 缺失 → 启动失败', () => {
    // 手动建一张"损坏"表
    const bad = new Database(dbPath);
    bad.exec('CREATE TABLE foo (id INTEGER)');
    bad.close();

    expect(() => openDatabase(dbPath)).toThrow(/schema version mismatch/);
  });

  it('schema_version 写入非 SCHEMA_VERSION → 启动失败（降级保护）', () => {
    // 先用 openDatabase 正常建库（落到当前 SCHEMA_VERSION）
    const db = openDatabase(dbPath);
    db.close();

    // 篡改 schema_version 为大于当前值 → 视作"DB 比 binary 新" → loud fail
    const corrupt = new Database(dbPath);
    corrupt.prepare('UPDATE schema_version SET version = ?').run(99);
    corrupt.close();

    // 错误信息应包含 "DB 99 > expected" 或类似"downgrade unsafe"
    expect(() => openDatabase(dbPath)).toThrow(/downgrade unsafe|schema version mismatch/);
  });

  it('v6.5: 老 DB (schema_version=4) 启动 → migration 升到 5 + max_tokens CHECK 放宽', () => {
    // v6.5: 4→5 migration。SQLite 不支持 ALTER CHECK → 需表重建。
    //   1) 手动建 v4 库（max_tokens CHECK ≤32000 + 一行 legacy 数据 'a1'/'echo'）。
    //   2) 调 openDatabase 触发 migration。
    //   3) 断言：schema_version=5，max_tokens=100_000 可插入，legacy 'a1' 仍存在。
    const dir = mkdtempSync(join(tmpdir(), 'core-mig-'));
    const path = join(dir, 'mig.db');
    try {
      const seed = new Database(path);
      seed.pragma('journal_mode = WAL');
      seed.pragma('foreign_keys = ON');
      seed.exec(`
        CREATE TABLE agents (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL DEFAULT '',
          llm_provider TEXT NOT NULL DEFAULT 'openai-compatible',
          base_url TEXT NOT NULL,
          model TEXT NOT NULL,
          max_tokens INTEGER,
          context_window INTEGER,
          reasoning_effort TEXT,
          api_key TEXT,
          enabled_api INTEGER NOT NULL DEFAULT 0,
          system_prompt TEXT NOT NULL DEFAULT '',
          capabilities TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (llm_provider = 'openai-compatible'),
          CHECK (max_tokens IS NULL OR (max_tokens >= 1 AND max_tokens <= 32000)),
          CHECK (length(name) > 0 AND length(name) <= 64)
        );
        CREATE UNIQUE INDEX idx_agents_name ON agents(name);
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, client_key TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE messages (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
          content TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
        INSERT INTO schema_version (version, applied_at) VALUES (4, '2026-06-10T00:00:00.000Z');
        INSERT INTO agents (id, name, base_url, model, created_at, updated_at)
          VALUES ('a1', 'echo', 'http://x/v1', 'm', '2026-06-10T00:00:00.000Z', '2026-06-10T00:00:00.000Z');
      `);
      seed.close();

      // 触发 4→5 migration
      const db = openDatabase(path);

      // schema_version 升到 5
      const row = db.prepare('SELECT version FROM schema_version').get() as { version: number };
      expect(row.version).toBe(5);

      // max_tokens CHECK 已放宽 → 100_000 可写入
      expect(() =>
        db
          .prepare(
            `INSERT INTO agents (id, name, base_url, model, max_tokens, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            'a2',
            'big',
            'http://x/v1',
            'm',
            100_000,
            '2026-06-10T00:00:00.000Z',
            '2026-06-10T00:00:00.000Z',
          ),
      ).not.toThrow();

      // legacy 'a1' 仍存在（表重建必须保留数据）
      const existing = db.prepare('SELECT name FROM agents WHERE id=?').get('a1') as
        | { name: string }
        | undefined;
      expect(existing?.name).toBe('echo');

      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('v6.5: migration 失败时抛错 + schema_version 不变（不静默半状态）', () => {
    // v6.5: index.ts 加了 try/catch + 显式 ROLLBACK。
    //   用一个"半迁移"状态触发 catch：手动建 schema_version=4 + 一张同名的 agents_new，
    //   让 4→5 migration 里的 CREATE TABLE agents_new 撞名失败。
    //   断言：
    //     a) openDatabase 抛出 migration 4→5 failed 错误
    //     b) schema_version 仍为 4（外层 UPDATE 没被执行；ROLLBACK 真的回滚了事务）
    const dir = mkdtempSync(join(tmpdir(), 'core-mig-fail-'));
    const path = join(dir, 'fail.db');
    try {
      const seed = new Database(path);
      seed.pragma('journal_mode = WAL');
      seed.pragma('foreign_keys = ON');
      seed.exec(`
        CREATE TABLE agents (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL DEFAULT '',
          llm_provider TEXT NOT NULL DEFAULT 'openai-compatible',
          base_url TEXT NOT NULL,
          model TEXT NOT NULL,
          max_tokens INTEGER,
          context_window INTEGER,
          reasoning_effort TEXT,
          api_key TEXT,
          enabled_api INTEGER NOT NULL DEFAULT 0,
          system_prompt TEXT NOT NULL DEFAULT '',
          capabilities TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (llm_provider = 'openai-compatible'),
          CHECK (max_tokens IS NULL OR (max_tokens >= 1 AND max_tokens <= 32000)),
          CHECK (length(name) > 0 AND length(name) <= 64)
        );
        CREATE UNIQUE INDEX idx_agents_name ON agents(name);
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, client_key TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE messages (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
          content TEXT NOT NULL, created_at TEXT NOT NULL
        );
        -- 关键：先建一张同名的 agents_new 模拟"半迁移"状态
        -- 这样 4→5 migration 的 CREATE TABLE agents_new 会撞名失败
        CREATE TABLE agents_new (id TEXT PRIMARY KEY);
        CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
        INSERT INTO schema_version (version, applied_at) VALUES (4, '2026-06-10T00:00:00.000Z');
      `);
      seed.close();

      // 触发 4→5 migration → CREATE TABLE agents_new 撞名 → catch 路径
      expect(() => openDatabase(path)).toThrow(/migration 4 → 5 failed/);

      // 验证 schema_version 仍是 4：说明外层 UPDATE 没被执行；
      //   ROLLBACK 把整个 BEGIN TRANSACTION 块回滚（不留下半迁移状态）。
      const check = new Database(path, { readonly: true });
      try {
        const row = check.prepare('SELECT version FROM schema_version').get() as
          | { version: number }
          | undefined;
        expect(row?.version).toBe(4);
      } finally {
        check.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
