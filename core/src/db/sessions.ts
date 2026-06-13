// sessions 表 DAO：每个 session 绑一个 agent；client_key 作创建者审计字段。
import type { Database } from 'better-sqlite3';

export type SessionRow = {
  id: string;
  agent_id: string;
  client_key: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export class SessionsDAO {
  constructor(private readonly db: Database) {}

  insert(row: SessionRow): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, agent_id, client_key, title, created_at, updated_at)
         VALUES (@id, @agent_id, @client_key, @title, @created_at, @updated_at)`,
      )
      .run(row);
  }

  get(id: string): SessionRow | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      | SessionRow
      | undefined;
    return row ?? null;
  }

  listByAgent(agentId: string): SessionRow[] {
    return this.db
      .prepare('SELECT * FROM sessions WHERE agent_id = ? ORDER BY created_at ASC')
      .all(agentId) as SessionRow[];
  }

  listByClientKey(clientKey: string): SessionRow[] {
    return this.db
      .prepare('SELECT * FROM sessions WHERE client_key = ? ORDER BY created_at ASC')
      .all(clientKey) as SessionRow[];
  }

  updateTimestamp(id: string, updatedAt: string): void {
    this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(updatedAt, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }
}
