-- v6.1 起步 schema_version=1。后续 ALTER TABLE 加新字段；不实现自动迁移。
-- 首启动时执行；后续启动跳过（靠 schema_version 判定）。

CREATE TABLE IF NOT EXISTS agents (
  id            TEXT    PRIMARY KEY,
  name          TEXT    NOT NULL UNIQUE,
  description   TEXT    NOT NULL DEFAULT '',
  llm_provider  TEXT    NOT NULL DEFAULT 'openai-compatible',
  base_url      TEXT    NOT NULL,
  model         TEXT    NOT NULL,
  max_tokens    INTEGER,
  enabled_api   INTEGER NOT NULL DEFAULT 0,
  system_prompt TEXT    NOT NULL DEFAULT '',
  capabilities  TEXT    NOT NULL DEFAULT '[]',
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  CHECK (llm_provider = 'openai-compatible'),
  CHECK (max_tokens IS NULL OR (max_tokens >= 1 AND max_tokens <= 32000)),
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
