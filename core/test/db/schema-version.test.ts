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

  it('schema_version 写入非 2 → 启动失败', () => {
    // 先用 openDatabase 正常建库
    const db = openDatabase(dbPath);
    db.close();

    // 篡改 schema_version
    const corrupt = new Database(dbPath);
    corrupt.prepare('UPDATE schema_version SET version = ?').run(99);
    corrupt.close();

    expect(() => openDatabase(dbPath)).toThrow(/schema version mismatch.*expected 2, got 99/);
  });
});
