// core Fastify 装配：CORS、WS、DB 注入、路由注册、错误兜底、internal-client-key hook。
// v6.1 删除 registry 类 + EchoAgent 硬编码；DB 装饰供路由用。
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { Database } from 'better-sqlite3';
import type { Config } from './config.js';
import type { Compat } from './compat/load.js';
import { createLogger } from './logger.js';
import { AgentsDAO } from './db/agents.js';
import { SessionsDAO } from './db/sessions.js';
import { MessagesDAO } from './db/messages.js';
import { healthRoutes } from './routes/health.js';
import { agentRoutes } from './routes/agents.js';
import { agentItemRoutes } from './routes/agent-item.js';
import { sessionRoutes } from './routes/sessions.js';
import { sessionItemRoutes } from './routes/session-item.js';
import { messageRoutes } from './routes/messages.js';
import { chatRoutes } from './routes/chat.js';
import { internalClientKeyHook } from './hooks/internal-client-key.js';
import { HttpError } from './errors.js';
import { LLMNotImplementedError, LLMUpstreamError } from './llm/errors.js';

/**
 * 构建 core Fastify 实例：
 * - 装饰 `compat` / `db` / `agents` / `sessions` / `messages` / `config` 供路由用
 * - 注册 X-Internal-Client-Key hook（除 /health 外所有端点需要）
 * - 11 个 v6.1 端点（10 个新 + /v1/agents 改造）+ 1 个 /v1/chat v1 保留 + 1 个 /health
 */
export async function buildServer(cfg: Config, compat: Compat, db: Database) {
  const app = Fastify({ logger: createLogger(cfg.LOG_LEVEL) });

  app.decorate('compat', compat);
  app.decorate('db', db);
  app.decorate('config', cfg);
  app.decorate('agents', new AgentsDAO(db));
  app.decorate('sessions', new SessionsDAO(db));
  app.decorate('messages', new MessagesDAO(db));

  const origins = cfg.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
  await app.register(cors, { origin: origins, credentials: true });
  await app.register(websocket);

  // 内部鉴权 hook（v6.1 新增）
  await app.register(internalClientKeyHook);

  // 路由注册
  await app.register(async instance => {
    await healthRoutes(instance);
    await agentRoutes(instance);
    await agentItemRoutes(instance);
    await sessionRoutes(instance);
    await sessionItemRoutes(instance);
    await messageRoutes(instance);
    await chatRoutes(instance);  // v1 保留
  });

  // 统一错误兜底
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ data: null, code: err.status, message: err.code });
    }
    if (err instanceof LLMNotImplementedError) {
      return reply.code(501).send({ data: null, code: 501, message: 'not_implemented' });
    }
    if (err instanceof LLMUpstreamError) {
      app.log.error({ err }, 'LLM upstream error');
      return reply.code(502).send({ data: null, code: 502, message: 'upstream_error' });
    }
    if ((err as Error).name === 'ZodError' || (err as { validation?: unknown }).validation) {
      return reply.code(400).send({ data: null, code: 400, message: 'invalid_body' });
    }
    app.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ data: null, code: 500, message: 'internal_error' });
  });

  return app;
}

// Fastify 类型扩展
declare module 'fastify' {
  interface FastifyInstance {
    compat: Compat;
    db: Database;
    config: Config;
    agents: AgentsDAO;
    sessions: SessionsDAO;
    messages: MessagesDAO;
  }
}
