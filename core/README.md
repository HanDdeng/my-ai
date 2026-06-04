# @my-ai/core

agent 核心服务。会话、agent 注册、工具调用、LLM 抽象、OS 自动化都放这里。

## 开发

```bash
cp .env.example .env
pnpm --filter core run dev
```

默认监听 `http://127.0.0.1:8788`。

## 当前接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/health`         | 健康检查 |
| GET  | `/v1/agents`      | 列出已注册 agent |
| POST | `/v1/chat`        | 单轮对话（同步返回） |

请求示例：

```bash
curl -X POST http://127.0.0.1:8788/v1/chat \
  -H 'content-type: application/json' \
  -d '{"agentId":"echo","sessionId":"s1","content":"hello"}'
```

## 目录

```
src/
  index.ts           # 入口
  server.ts          # Fastify 装配
  config.ts          # 环境变量解析
  logger.ts          # pino
  llm/               # LLM 抽象 + mock 实现
    types.ts
    mock.ts
    index.ts
  agent/             # agent 抽象与注册
    types.ts
    registry.ts
    echo.ts
  routes/            # HTTP 路由
    health.ts
    agents.ts
    chat.ts
```

## 后续

- [ ] LLM OpenAI 兼容协议实现（替换 mock）
- [ ] 工具注册表（tool registry）
- [ ] OS 自动化工具：shell / 文件 / 键鼠 / 屏幕
- [ ] 流式响应（SSE / WebSocket）
- [ ] 会话持久化
