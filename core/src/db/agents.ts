// agents 表 DAO：参考 gateway/src/auth/store.ts 的 class 模式。
// 所有方法同步（better-sqlite3 同步 API）。
// v6.3.1: 新增 context_window 字段（云端模型需要区分 maxTokens 与 context window）。
import type { Database } from 'better-sqlite3';

/** DB 行（snake_case 字段名与 SQL 对应） */
export type AgentRow = {
  id: string;
  name: string;
  description: string;
  llm_provider: string;
  base_url: string;
  model: string;
  max_tokens: number | null;
  context_window: number | null;
  enabled_api: number; // 0 or 1
  system_prompt: string;
  capabilities: string; // JSON 字符串
  created_at: string;
  updated_at: string;
};

export class AgentsDAO {
  constructor(private readonly db: Database) {}

  insert(row: AgentRow): void {
    this.db
      .prepare(
        `INSERT INTO agents (
          id, name, description, llm_provider, base_url, model, max_tokens,
          context_window, enabled_api, system_prompt, capabilities, created_at, updated_at
        ) VALUES (
          @id, @name, @description, @llm_provider, @base_url, @model, @max_tokens,
          @context_window, @enabled_api, @system_prompt, @capabilities, @created_at, @updated_at
        )`,
      )
      .run(row);
  }

  get(id: string): AgentRow | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as
      | AgentRow
      | undefined;
    return row ?? null;
  }

  list(): AgentRow[] {
    return this.db.prepare('SELECT * FROM agents ORDER BY created_at ASC').all() as AgentRow[];
  }

  update(id: string, fields: Partial<Omit<AgentRow, 'id' | 'llm_provider'>>): void {
    const keys = Object.keys(fields);
    if (keys.length === 0) {
      return;
    }
    const setClause = keys.map(k => `${k} = @${k}`).join(', ');
    this.db.prepare(`UPDATE agents SET ${setClause} WHERE id = @id`).run({ ...fields, id });
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM agents WHERE id = ?').run(id);
  }
}
