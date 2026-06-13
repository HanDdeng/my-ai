// 4→5: 解除 agents.max_tokens 上限（≤32000 → 仅保留 ≥1）。
// SQLite 不支持 ALTER CONSTRAINT，需表重建。所有字段与 schema_version=4 一致，
// 仅 max_tokens CHECK 被放宽。
//
// ⚠ 维护警告：本文件 MIGRATION_4_TO_5_SQL 里的 agents_new DDL 是 schema_version=4 时
//   agents 表的冻结快照（"schema snapshot"）。未来给 agents 加列时，必须同步更新：
//     1) ./schema.ts 里 SCHEMA_SQL 的 agents 表 DDL
//     2) 本文件 MIGRATION_4_TO_5_SQL 的 agents_new DDL
//     3) "最新一份 migration"（v5→6 的 *_NEW 表 DDL）
//   migration runner 不会自动 diff agents 表结构；漏改任意一处都会让
//   `INSERT INTO agents_new SELECT * FROM agents` 失败（列数不匹配）。
//
// 同目录 0005_relax_max_tokens.sql 仅作 git archaeology / 文档源保留；
// 本 .ts 是 runtime 真正消费的版本（build-safe；tsc 把 template literal 烤进 dist/）。
export const MIGRATION_4_TO_5_SQL = `
BEGIN TRANSACTION;

CREATE TABLE agents_new (
  id                TEXT    PRIMARY KEY,
  name              TEXT    NOT NULL UNIQUE,
  description       TEXT    NOT NULL DEFAULT '',
  llm_provider      TEXT    NOT NULL DEFAULT 'openai-compatible',
  base_url          TEXT    NOT NULL,
  model             TEXT    NOT NULL,
  max_tokens        INTEGER,
  context_window    INTEGER,
  reasoning_effort  TEXT,
  api_key           TEXT,
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

INSERT INTO agents_new SELECT * FROM agents;
DROP TABLE agents;
ALTER TABLE agents_new RENAME TO agents;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_name ON agents(name);

UPDATE schema_version SET version = 5, applied_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');

COMMIT;
`;
