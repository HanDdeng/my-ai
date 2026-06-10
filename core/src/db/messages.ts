// messages 表 DAO：按 id 字典序保证消息顺序（UUID v4）。
import type { Database } from 'better-sqlite3';

export type MessageRow = {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
};

export class MessagesDAO {
  constructor(private readonly db: Database) {}

  insert(row: MessageRow): void {
    this.db
      .prepare(
        `INSERT INTO messages (id, session_id, role, content, created_at)
         VALUES (@id, @session_id, @role, @content, @created_at)`,
      )
      .run(row);
  }

  get(id: string): MessageRow | null {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as
      | MessageRow
      | undefined;
    return row ?? null;
  }

  /** 按 id 字典序升序（UUID v4 字典序） */
  listBySession(sessionId: string): MessageRow[] {
    return this.db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC')
      .all(sessionId) as MessageRow[];
  }
}
