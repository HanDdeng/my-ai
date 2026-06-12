// agents 表 DAO：参考 gateway/src/auth/store.ts 的 class 模式。
// 所有方法同步（better-sqlite3 同步 API）。
// v6.3.1: 新增 context_window 字段（云端模型需要区分 maxTokens 与 context window）。
// v6.3.2: 新增 reasoning_effort 字段（OpenAI o1/o3 思考强度；其他 provider 静默忽略）。
// v6.4:   新增 api_key 字段（per-agent 凭据；null = 回退到 env LLM_API_KEY）；
//   移除 reasoning_effort 字段（不再由 agent 持久化；调用时由消息接口传参）。
//   DB 列仍保留（schema 不删除列；只是 DAO 不读写），未来可能恢复使用。
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
  // v6.4: per-agent 凭据；null = 回退到 env LLM_API_KEY。
  api_key: string | null;
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
          context_window, api_key, enabled_api, system_prompt, capabilities, created_at, updated_at
        ) VALUES (
          @id, @name, @description, @llm_provider, @base_url, @model, @max_tokens,
          @context_window, @api_key, @enabled_api, @system_prompt, @capabilities, @created_at, @updated_at
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
