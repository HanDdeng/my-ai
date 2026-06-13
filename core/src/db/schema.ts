// v6.1 起步 schema_version=1；v6.3.1 加 context_window → schema_version=2。
// v6.3.2 加 reasoning_effort → schema_version=3。
// v6.4 加 agents.api_key（per-agent 凭据，nullable，回退到 env LLM_API_KEY） → schema_version=4。
// v6.5 放宽 max_tokens（去 ≤32000）→ schema_version=5。
// 后续 ALTER TABLE 加新字段；schema bump 时 1) 写 schema.sql 新版本；2) 在 db/migrations/ 加 .sql 跑 4→5 类渐进。
// 首启动时执行 schema.sql 落到 SCHEMA_VERSION；老库启动走 migrations/000N_*.sql 顺序应用。
//
// 注意：本文件是 build-safe 的 schema 内联（参考 gateway/src/db.ts 模式）。
// 旧版 schema.sql + migrations/*.sql 在 ts/tsx dev 时用 import.meta.url 读，运行 OK；
// 但 tsc 只 emit .js/.d.ts → dist/db/*.sql 缺失 → production `node dist/index.js` ENOENT。
// 把 SQL inline 成 JS template literal 后，tsc 把内容直接编进 .js，runtime 不再需要磁盘 SQL 文件。
// 旧 .sql 仍保留在仓库（git archaeology + 未来 migration 复制源）。
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agents (
  id                TEXT    PRIMARY KEY,
  name              TEXT    NOT NULL UNIQUE,
  description       TEXT    NOT NULL DEFAULT '',
  llm_provider      TEXT    NOT NULL DEFAULT 'openai-compatible',
  base_url          TEXT    NOT NULL,
  model             TEXT    NOT NULL,
  max_tokens        INTEGER,
  context_window    INTEGER,
  reasoning_effort  TEXT,                  -- 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' (nullable)
  api_key           TEXT,                  -- v6.4: per-agent key（nullable；null = 回退到 env LLM_API_KEY）
  enabled_api       INTEGER NOT NULL DEFAULT 0,
  system_prompt     TEXT    NOT NULL DEFAULT '',
  capabilities      TEXT    NOT NULL DEFAULT '[]',
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,
  CHECK (llm_provider = 'openai-compatible'),
  CHECK (max_tokens IS NULL OR max_tokens >= 1),
  CHECK (context_window IS NULL OR (context_window >= 1 AND context_window <= 2000000)),
  CHECK (reasoning_effort IS NULL OR reasoning_effort IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh')),
  CHECK (length(name) > 0 AND length(name) <= 64),
  CHECK (length(description) <= 256),
  CHECK (length(model) > 0 AND length(model) <= 128),
  CHECK (length(base_url) > 0 AND length(base_url) <= 512),
  CHECK (length(system_prompt) <= 8192),
  CHECK (enabled_api IN (0, 1))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_name ON agents(name);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  client_key  TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  CHECK (length(id) > 0),
  CHECK (length(agent_id) > 0),
  CHECK (length(client_key) > 0)
);
CREATE INDEX IF NOT EXISTS idx_sessions_agent_id   ON sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_client_key ON sessions(client_key);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CHECK (role IN ('user', 'assistant', 'system')),
  CHECK (length(content) > 0)
);
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL
);
`;
