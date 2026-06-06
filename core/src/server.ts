// core Fastify 装配：CORS、WS、LLM/Registry 注入、路由注册、错误兜底。
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { Config } from './config.js';
import type { Compat } from './compat/load.js';
import { createLogger } from './logger.js';
import { createLLMClient } from './llm/index.js';
import { AgentRegistry } from './agent/registry.js';
import { EchoAgent } from './agent/echo.js';
import { healthRoutes } from './routes/health.js';
import { agentRoutes } from './routes/agents.js';
import { chatRoutes } from './routes/chat.js';

/**
 * 构建 core Fastify 实例：app 上的 `registry` 装饰供路由访问 agent，
 * `compat` 装饰供路由访问版本/上游信息。
 */
export async function buildServer(cfg: Config, compat: Compat) {
  const app = Fastify({ logger: createLogger(cfg.LOG_LEVEL) });

  app.decorate('compat', compat);

  const origins = cfg.CORS_ORIGINS.split(',')
    .map(s => s.trim())
    .filter(Boolean);
  await app.register(cors, { origin: origins, credentials: true });
  await app.register(websocket);

  // 构造依赖：LLM 客户端与 agent 注册表。
  const llm = createLLMClient(cfg);
  const registry = new AgentRegistry();
  // 注册默认 agent；后续 agent 在此追加。
  registry.register(new EchoAgent(llm));

  app.decorate('registry', registry);

  await app.register(async instance => {
    await healthRoutes(instance);
    await agentRoutes(instance, registry);
    await chatRoutes(instance, registry);
  });

  // 全局错误兜底：避免栈泄露，500 统一回包。
  app.setErrorHandler((err, _req, reply) => {
    app.log.error({ err }, 'unhandled error');
    reply.code(500).send({ ok: false, error: 'internal_error' });
  });

  return app;
}

// Fastify 类型扩展：把 compat 挂到 app 实例上
declare module 'fastify' {
  interface FastifyInstance {
    compat: Compat;
  }
}
