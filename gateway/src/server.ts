// 网关 Fastify 装配：注册中间件（CORS、WS）、注入 core 客户端、注册路由、设置错误兜底。
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { Config } from './config.js';
import { createLogger } from './logger.js';
import { CoreClient } from './clients/core.js';
import { healthRoutes } from './routes/health.js';
import { agentRoutes } from './routes/agents.js';

/**
 * 构建网关 Fastify 实例：app 上的 `core` 装饰供路由访问上游客户端。
 * 不在内部调用 listen，便于测试。
 */
export async function buildServer(cfg: Config) {
  const app = Fastify({ logger: createLogger(cfg.LOG_LEVEL) });

  // CORS：拆分逗号分隔字符串，trim 后过滤空值。
  const origins = cfg.CORS_ORIGINS.split(',')
    .map(s => s.trim())
    .filter(Boolean);
  await app.register(cors, { origin: origins, credentials: true });
  await app.register(websocket);

  const core = new CoreClient({ baseUrl: cfg.CORE_URL });
  app.decorate('core', core);

  await app.register(async instance => {
    await healthRoutes(instance, core);
    await agentRoutes(instance, core);
  });

  // 全局错误兜底：避免 5xx 漏出去时把栈暴露给客户端。
  app.setErrorHandler((err, _req, reply) => {
    app.log.error({ err }, 'unhandled error');
    reply.code(500).send({ ok: false, error: 'internal_error' });
  });

  return app;
}
