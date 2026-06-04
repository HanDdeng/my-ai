# @my-ai/gateway

多客户端访问 `core` 的网关层。当前职责：路由转发、健康检查、协议适配。

## 开发

```bash
# 复制环境变量
cp .env.example .env

# 启动开发模式（tsx watch）
pnpm --filter gateway run dev

# 构建并运行
pnpm --filter gateway run build
pnpm --filter gateway run start
```

默认监听 `http://127.0.0.1:8787`，代理到 `http://127.0.0.1:8788`（core）。

## 当前路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/health`         | 网关 + 上游 core 健康状态 |
| GET  | `/v1/agents`      | 列出可用 agent（转发到 core） |

## 后续

- WebSocket：会话流式响应
- 鉴权：API key / session token
- 限流、按 agent 路由、配置中心
