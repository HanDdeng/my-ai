// 网关鉴权 store：封装 clients + pairing_codes 表的 CRUD。
// 同步 better-sqlite3 API（v3 阶段用同步；v4+ 可换 async DB）。
import type { Database } from 'better-sqlite3';

export type Client = {
  id: string;
  key_hash: string;
  name: string | null;
  created_at: number;
  last_seen_at: number;
  meta: string | null;
};

export type PairingCode = {
  token: string;
  client_id: string;
  client_name: string | null;
  expires_at: number;
  attempts: number;
};

export class AuthStore {
  constructor(private readonly db: Database) {}

  insertClient(c: {
    id: string;
    keyHash: string;
    name: string | null;
    createdAt: number;
    lastSeenAt: number;
  }): void {
    this.db
      .prepare(
        'INSERT INTO clients (id, key_hash, name, created_at, last_seen_at, meta) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(c.id, c.keyHash, c.name, c.createdAt, c.lastSeenAt, null);
  }

  findByHash(hash: string): Client | null {
    const row = this.db.prepare('SELECT * FROM clients WHERE id = ?').get(hash) as
      | Client
      | undefined;
    return row ?? null;
  }

  updateLastSeen(id: string, ts: number): void {
    this.db.prepare('UPDATE clients SET last_seen_at = ? WHERE id = ?').run(ts, id);
  }

  deleteExpiredClients(threshold: number): number {
    const result = this.db.prepare('DELETE FROM clients WHERE last_seen_at < ?').run(threshold);
    return result.changes;
  }

  insertPairingCode(c: {
    token: string;
    clientId: string;
    clientName: string | null;
    expiresAt: number;
  }): void {
    this.db
      .prepare(
        'INSERT INTO pairing_codes (token, client_id, client_name, expires_at, attempts) VALUES (?, ?, ?, ?, 0)',
      )
      .run(c.token, c.clientId, c.clientName, c.expiresAt);
  }

  findPairingCode(token: string): PairingCode | null {
    const row = this.db.prepare('SELECT * FROM pairing_codes WHERE token = ?').get(token) as
      | PairingCode
      | undefined;
    return row ?? null;
  }

  incrementAttempts(token: string): void {
    this.db.prepare('UPDATE pairing_codes SET attempts = attempts + 1 WHERE token = ?').run(token);
  }

  deletePairingCode(token: string): void {
    this.db.prepare('DELETE FROM pairing_codes WHERE token = ?').run(token);
  }

  /**
   * 私有模式 CLI 解析时调：把 pairing_codes.client_id 写入 clients 表，删除 pairing_code。
   * 必须在事务里跑（失败回滚）。
   */
  commitPairingCode(token: string, now: number): void {
    const tx = this.db.transaction(() => {
      const code = this.findPairingCode(token);
      if (!code) {
        return false;
      }
      this.insertClient({
        id: code.client_id,
        keyHash: code.client_id,
        name: code.client_name,
        createdAt: now,
        lastSeenAt: now,
      });
      this.deletePairingCode(token);
      return true;
    });
    tx();
  }

  listClients(): Client[] {
    return this.db.prepare('SELECT * FROM clients ORDER BY created_at DESC').all() as Client[];
  }
}
