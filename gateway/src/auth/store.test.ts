// auth/store.ts 单元测试：用 :memory: SQLite 跑所有 CRUD。
import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../db.js';
import { AuthStore } from './store.js';

describe('AuthStore', () => {
  let store: AuthStore;

  beforeEach(() => {
    const db = openDatabase(':memory:');
    store = new AuthStore(db);
  });

  describe('insertClient + findByHash', () => {
    it('插入后能按 hash 找到', () => {
      const id = 'hash-abc';
      const now = Date.now();
      store.insertClient({ id, keyHash: id, name: 'alice', createdAt: now, lastSeenAt: now });
      const found = store.findByHash(id);
      expect(found).toMatchObject({ id, name: 'alice', created_at: now, last_seen_at: now });
    });

    it('未插入的 hash 返回 null', () => {
      expect(store.findByHash('nonexistent')).toBeNull();
    });

    it('同名 hash 重复插入抛错（唯一约束）', () => {
      const id = 'hash-abc';
      const now = Date.now();
      store.insertClient({ id, keyHash: id, name: null, createdAt: now, lastSeenAt: now });
      expect(() =>
        store.insertClient({ id, keyHash: id, name: null, createdAt: now, lastSeenAt: now }),
      ).toThrow();
    });
  });

  describe('updateLastSeen', () => {
    it('更新 last_seen_at', () => {
      const id = 'hash-abc';
      const now = Date.now();
      store.insertClient({ id, keyHash: id, name: null, createdAt: now, lastSeenAt: now });
      const newTs = now + 1000;
      store.updateLastSeen(id, newTs);
      const found = store.findByHash(id);
      expect(found?.last_seen_at).toBe(newTs);
    });

    it('不存在的 id 不抛错（idempotent）', () => {
      expect(() => store.updateLastSeen('nonexistent', Date.now())).not.toThrow();
    });
  });

  describe('deleteExpiredClients', () => {
    it('删除 last_seen_at < threshold 的 client', () => {
      const now = Date.now();
      store.insertClient({
        id: 'old',
        keyHash: 'old',
        name: null,
        createdAt: now,
        lastSeenAt: now - 10_000,
      });
      store.insertClient({
        id: 'new',
        keyHash: 'new',
        name: null,
        createdAt: now,
        lastSeenAt: now,
      });
      const deleted = store.deleteExpiredClients(now - 5_000);
      expect(deleted).toBe(1);
      expect(store.findByHash('old')).toBeNull();
      expect(store.findByHash('new')).not.toBeNull();
    });
  });

  describe('pairing_codes', () => {
    it('insertPairingCode + findPairingCode + deletePairingCode', () => {
      const now = Date.now();
      store.insertPairingCode({
        token: 'tk-1',
        clientId: 'hash-abc',
        clientName: 'alice',
        expiresAt: now + 300_000,
      });
      const found = store.findPairingCode('tk-1');
      expect(found).toMatchObject({
        token: 'tk-1',
        client_id: 'hash-abc',
        client_name: 'alice',
        attempts: 0,
      });
      store.deletePairingCode('tk-1');
      expect(store.findPairingCode('tk-1')).toBeNull();
    });

    it('incrementAttempts', () => {
      const now = Date.now();
      store.insertPairingCode({
        token: 'tk',
        clientId: 'c',
        clientName: null,
        expiresAt: now + 60_000,
      });
      store.incrementAttempts('tk');
      store.incrementAttempts('tk');
      expect(store.findPairingCode('tk')?.attempts).toBe(2);
    });

    it('commitPairingCode 写 clients + 删 pairing_code', () => {
      const now = Date.now();
      store.insertPairingCode({
        token: 'tk',
        clientId: 'hash-abc',
        clientName: 'alice',
        expiresAt: now + 60_000,
      });
      store.commitPairingCode('tk', now);
      expect(store.findByHash('hash-abc')).toMatchObject({ name: 'alice' });
      expect(store.findPairingCode('tk')).toBeNull();
    });
  });

  describe('listClients', () => {
    it('返回所有 client', () => {
      const now = Date.now();
      store.insertClient({ id: 'a', keyHash: 'a', name: 'alice', createdAt: now, lastSeenAt: now });
      store.insertClient({ id: 'b', keyHash: 'b', name: 'bob', createdAt: now, lastSeenAt: now });
      const list = store.listClients();
      expect(list).toHaveLength(2);
    });
  });
});
