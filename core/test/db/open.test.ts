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

  it('首次启动建表 + 写 schema_version=1', () => {
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
    expect(row.version).toBe(1);
  });

  it('二次启动不重复建表 + 不报错', () => {
    openDatabase(dbPath);
    // 二次打开应不抛错
    const db2 = openDatabase(dbPath);
    const row = db2.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(row.version).toBe(1);
  });

  it('打开 :memory: 也工作', () => {
    const db = openDatabase(':memory:');
    const row = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(row.version).toBe(1);
  });
});
