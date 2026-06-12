import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@/db/index.js';

describe('openDatabase', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'core-db-'));
    dbPath = join(dir, 'core.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('首次启动建表 + 写 schema_version=5（v6.5: 解除 max_tokens 上限）', () => {
    const db = openDatabase(dbPath);

    // 4 张表都建好
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('agents');
    expect(tableNames).toContain('sessions');
    expect(tableNames).toContain('messages');
    expect(tableNames).toContain('schema_version');

    // schema_version 写入
    const row = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(row.version).toBe(5);

    // v6.3.1: agents 表必须包含 context_window 列
    const cols = db.prepare("PRAGMA table_info('agents')").all() as Array<{ name: string }>;
    expect(cols.map(c => c.name)).toContain('context_window');
    // v6.4: agents 表必须包含 api_key 列（reasoning_effort 列保留在 DB 但 DAO 不再读写）。
    expect(cols.map(c => c.name)).toContain('api_key');
  });

  it('二次启动不重复建表 + 不报错', () => {
    openDatabase(dbPath);
    // 二次打开应不抛错
    const db2 = openDatabase(dbPath);
    const row = db2.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(row.version).toBe(5);
  });

  it('打开 :memory: 也工作', () => {
    const db = openDatabase(':memory:');
    const row = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(row.version).toBe(5);
  });
});
