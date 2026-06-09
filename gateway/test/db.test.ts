// db.ts 单元测试：用 :memory: 验证表结构与 PRAGMA user_version。
import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '@/db.js';

describe('openDatabase', () => {
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('创建 clients 表', () => {
    const cols = db.prepare('PRAGMA table_info(clients)').all() as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['id', 'key_hash', 'name', 'created_at', 'last_seen_at', 'meta']),
    );
  });

  it('创建 pairing_codes 表', () => {
    const cols = db.prepare('PRAGMA table_info(pairing_codes)').all() as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['token', 'client_id', 'client_name', 'expires_at', 'attempts']),
    );
  });

  it('idx_clients_last_seen 索引存在', () => {
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_clients_last_seen'")
      .get();
    expect(idx).toBeDefined();
  });

  it('PRAGMA user_version = 1', () => {
    const row = db.pragma('user_version') as Array<{ user_version: number }>;
    expect(row[0]?.user_version).toBe(1);
  });
});
