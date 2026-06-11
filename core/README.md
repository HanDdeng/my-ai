# @my-ai/core

agent 核心服务。SQLite 持久化（agents / sessions / messages）+ 11 个 v6.1 CRUD 端点 + OpenAI 兼容 LLM 真实 HTTP 实现。

v6.1 起，core 端的所有 agent 配置 / 会话 / 消息均落库（`./core.db`）；registry 类 + EchoAgent 硬编码已删除，agent 实例化按"收到 chat 时 lazy 构造"走 DB。

## 开发

```bash
cp .env.example .env
pnpm --filter core run dev
```

默认监听 `http://127.0.0.1:8788`。SQLite 文件路径：`CORE_DB_PATH`（默认 `./core.db`）。

## 内部鉴权

除 `/health` 外所有端点需要 `X-Internal-Client-Key` header（由 gateway 注入，gateway 自身的 v3 `X-Client-Key` 鉴权在 gateway 端完成）。缺失 → 401 `unauthorized`。

`LLM_API_KEY`（env）供 OpenAI 兼容 LLM 客户端使用；不设则不发送 `Authorization` header（适用于本地无鉴权服务如 Ollama）。

## 当前接口

### 健康检查（公开）

| 方法 | 路径      | 说明                                  | 鉴权 |
| ---- | --------- | ------------------------------------- | ---- |
| GET  | `/health` | 健康检查（返回 `version` / `schema`） | ❌   |

### Agents（v6.1 新增 / 改造）

| 方法   | 路径              | 说明                                     | 鉴权 |
| ------ | ----------------- | ---------------------------------------- | ---- |
| GET    | `/v1/agents`      | 列 agent（DB 驱动）                      | ✅   |
| POST   | `/v1/agents`      | 新建 agent（`name` 唯一；重复 → 409）    | ✅   |
| GET    | `/v1/agents/{id}` | 取单个 agent                             | ✅   |
| PATCH  | `/v1/agents/{id}` | 改 agent（`llm_provider` / `id` 不可改） | ✅   |
| DELETE | `/v1/agents/{id}` | 删 agent（CASCADE sessions / messages）  | ✅   |

### Sessions（v6.1 新增）

| 方法   | 路径                | 说明                                         | 鉴权 |
| ------ | ------------------- | -------------------------------------------- | ---- |
| POST   | `/v1/sessions`      | 开新 session（`clientKey` 从内部 header 取） | ✅   |
| GET    | `/v1/sessions/{id}` | 取单个 session（跨 clientKey 可访问）        | ✅   |
| DELETE | `/v1/sessions/{id}` | 删 session（CASCADE messages）               | ✅   |

### Messages（v6.1 新增）

| 方法 | 路径                         | 说明                                        | 鉴权 |
| ---- | ---------------------------- | ------------------------------------------- | ---- |
| GET  | `/v1/sessions/{id}/messages` | 列历史消息（按 id 字典序升序）              | ✅   |
| POST | `/v1/sessions/{id}/messages` | 发一条消息（同步 chat，写真实 OpenAI 兼容） | ✅   |

### v1 保留（v5 client 兼容）

| 方法 | 路径       | 说明                                                                                                        | 鉴权 |
| ---- | ---------- | ----------------------------------------------------------------------------------------------------------- | ---- |
| POST | `/v1/chat` | v1 同步 chat 路由（响应格式 `{agentId, sessionId, reply, finishedAt}`，保留到所有 v5 客户端下线后评估删除） | ✅   |

### 错误码

| code | message               | 触发                                   |
| ---- | --------------------- | -------------------------------------- |
| 0    | `ok`                  | 正常                                   |
| 400  | `invalid_body`        | zod 校验失败 / 字段长度超限 / 字段缺失 |
| 401  | `unauthorized`        | `X-Internal-Client-Key` 缺失           |
| 404  | `agent_not_found`     | `agentId` 不存在                       |
| 404  | `session_not_found`   | `sessionId` 不存在                     |
| 409  | `agent_name_conflict` | `agents.name` UNIQUE 冲突              |
| 500  | `internal_error`      | 兜底                                   |
| 501  | `not_implemented`     | 预留（v6.1 阶段实际不触发）            |
| 502  | `upstream_error`      | OpenAI 兼容服务不可达 / 响应异常       |

## 9 字段 agent 模型

| 字段            | 类型      | 约束                                              |
| --------------- | --------- | ------------------------------------------------- |
| `name`          | TEXT      | 1..64 chars，DB UNIQUE                            |
| `description`   | TEXT      | 0..256 chars，默认 `''`                           |
| `llm_provider`  | TEXT      | 固定 `openai-compatible`（v6.1 CHECK 锁死）       |
| `base_url`      | TEXT      | 1..512 chars；**必须含版本路径**（如 `/v1` 后缀） |
| `model`         | TEXT      | 1..128 chars                                      |
| `max_tokens`    | INTEGER   | NULL 或 1..32000                                  |
| `enabled_api`   | INTEGER   | 0 或 1（**v6.1 预留字段**，core 不消费）          |
| `system_prompt` | TEXT      | 0..8192 chars，默认 `''`                          |
| `capabilities`  | TEXT JSON | 灵活 JSON 数组                                    |

## 目录

```
src/
  index.ts                 # 入口：装配 DB + 监听 + 优雅退出
  server.ts                # Fastify 装配 + 5 分支 setErrorHandler
  config.ts                # env 校验（PORT / HOST / LOG_LEVEL / CORS_ORIGINS / LLM_API_KEY / CORE_DB_PATH）
  logger.ts                # pino
  errors.ts                # HttpError 结构化错误
  db/
    schema.sql             # 4 表 DDL（agents / sessions / messages / schema_version）
    index.ts               # openDatabase + schema_version 检查
    agents.ts              # AgentsDAO（CRUD + UNIQUE 冲突）
    sessions.ts            # SessionsDAO（CRUD + listByAgent / listByClientKey）
    messages.ts            # MessagesDAO（按 id 字典序）
  llm/
    types.ts               # LLMClient / ChatMessage / ChatRequest / ChatResponse
    factory.ts             # Map<provider, factory> 注册表
    openai-compatible.ts   # 真实 HTTP 客户端（POST {base_url}/chat/completions）
    errors.ts              # LLMNotImplementedError / LLMUpstreamError
    mock.ts                # MockLLMClient（仅 CI 注入用；factory 不注册）
    index.ts               # createLLMClient(provider, llmConfig) 入口
  hooks/
    internal-client-key.ts # X-Internal-Client-Key 内部鉴权（/health 公开）
  routes/
    health.ts              # GET /health
    agents.ts              # GET / POST /v1/agents
    agent-item.ts          # GET / PATCH / DELETE /v1/agents/{id}
    sessions.ts            # POST /v1/sessions
    session-item.ts        # GET / DELETE /v1/sessions/{id}
    messages.ts            # GET / POST /v1/sessions/{id}/messages
    chat.ts                # POST /v1/chat（v1 保留）
```

## 数据流（POST /v1/sessions/{id}/messages）

```
client → gateway (X-Client-Key 鉴权) → core (X-Internal-Client-Key)
  ↓
1. 校验 X-Internal-Client-Key（hook 抛 401 if missing）
2. 校验 body（zod；不通过 → 400）
3. DB.sessions.get(sid) → 拿 agent_id（不存在 → 404）
4. DB.agents.get(agent_id) → 拿 9 字段
5. DB.messages.listBySession(sid) → 拼上下文（按 id 字典序）
6. createLLMClient(agent.llm_provider, { baseUrl, apiKey, model, maxTokens })
7. llm.chat({ model, messages: [system?, ...history, user], maxTokens })
8. DB insert user message (id 来自 request) + assistant message (id 由 core 生成)
9. 同步返回 { userMessage, assistantMessage }
```

## 后续（v6.2+ 评估）

- [ ] 实际 LLM provider 实现（v6.1 仅 `openai-compatible` 真实接；后续加 `anthropic` / `ollama` / 自研）
- [ ] `enabled_api` 字段消费（v6.1 仅占位）
- [ ] 流式 chat 响应（v6.1 同步；后续评估 SSE / WebSocket streaming）
- [ ] API key 管理（v6.1 走 env `LLM_API_KEY`；后续评估 OS keychain / per-agent 加密存储 / client 端 header 注入）
- [ ] session 标题自动取首条消息前 N 字（v6.1 `title` 留空）
- [ ] context window 滑动 / token 限制（v6.1 全部历史塞 LLM）
- [ ] LLM 客户端缓存预热（v6.1 每次新实例；后续按 `agent.id` LRU 缓存）
- [ ] DB migration 工具（v6.1 `schema_version` 表起步 v=1；后续 ALTER TABLE 需迁移工具）
- [ ] agent 软删除 / archive / 启用-停用开关（v6.1 真删 CASCADE）
- [ ] agent 标签 / 分组 / 搜索
- [ ] messages 分页（v6.1 一次性返回 session 全部 messages）
- [ ] 工具注册表（tool registry）+ OS 自动化工具（README 原列项，与 v6.1 agent 协作正交）
- [ ] 评估删除 `POST /v1/chat`（v6.1 保留到所有 v5 客户端下线）
- [ ] client 端虚拟办公室 UI（由后续 v6.2+ 承接）
- [ ] compat 矩阵版本 bump（v6.1 文档不锁；后续 写代码时按 v2 规则处理）
