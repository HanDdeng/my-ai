// 网关 Fastify 装配：注册中间件（CORS、WS、auth）、注入 core 客户端、注册路由、设置错误兜底。
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { Config } from './config.js';
import type { Compat } from './compat/load.js';
import type { AuthStore } from './auth/store.js';
import { createLogger } from './logger.js';
import { CoreClient } from './clients/core.js';
import { healthRoutes } from './routes/health.js';
import { agentRoutes } from './routes/agents.js';
import { pairRoutes } from './routes/pair.js';
import { pairStatusRoutes } from './routes/pair-status.js';
import { pairResolveRoutes } from './routes/internal/pair-resolve.js';
import { clientsRoutes } from './routes/internal/clients.js';
import { authMiddleware } from './auth/middleware.js';
import { err as errResp } from './response.js';
import { startCleanupTask } from './auth/cleanup.js';

/**
 * 构建网关 Fastify 实例：app 上的 `core` 装饰供路由访问上游客户端，
 * `compat` 装饰供路由访问版本/上游信息，`authStore` 装饰供 middleware/routes 访问持久层。
 * 不在内部调用 listen，便于测试。
 */
export async function buildServer(cfg: Config, compat: Compat, authStore: AuthStore) {
  const app = Fastify({ logger: createLogger(cfg.LOG_LEVEL) });

  app.decorate('compat', compat);
  app.decorate('authStore', authStore);
  // exactOptionalPropertyTypes 下 undefined 不能塞进可选字段，按需展开。
  const config: { GATEWAY_PAIRING_PUBLIC: boolean; GATEWAY_PAIR_KEY?: string } = {
    GATEWAY_PAIRING_PUBLIC: cfg.GATEWAY_PAIRING_PUBLIC,
  };
  if (cfg.GATEWAY_PAIR_KEY !== undefined) {
    config.GATEWAY_PAIR_KEY = cfg.GATEWAY_PAIR_KEY;
  }
  app.decorate('config', config);

  // CORS：拆分逗号分隔字符串，trim 后过滤空值。
  const origins = cfg.CORS_ORIGINS.split(',')
    .map(s => s.trim())
    .filter(Boolean);
  await app.register(cors, { origin: origins, credentials: true });
  await app.register(websocket);

  // 鉴权中间件（白名单放行 + 验 X-Client-Key）
  await app.register(authMiddleware);

  const core = new CoreClient({ baseUrl: cfg.CORE_URL });
  app.decorate('core', core);

  // 公开 routes
  await app.register(healthRoutes);
  await app.register(pairRoutes);
  await app.register(pairStatusRoutes);

  // 内部 routes（middleware 不鉴权，handler 自检 127.0.0.1）
  await app.register(pairResolveRoutes);
  await app.register(clientsRoutes);

  // 业务 routes（需鉴权）
  await app.register(async instance => {
    await agentRoutes(instance, core);
  });

  // 全局错误兜底：避免 5xx 漏出去时把栈暴露给客户端。
  app.setErrorHandler((err, _req, reply) => {
    app.log.error({ err }, 'unhandled error');
    reply.code(500).send(errResp(500, 'internal_error'));
  });

  // 启动过期清理任务
  if (cfg.GATEWAY_PAIRING_KEY_TTL && cfg.GATEWAY_PAIRING_KEY_TTL > 0) {
    startCleanupTask(app, cfg.GATEWAY_PAIRING_KEY_TTL);
  }

  return app;
}

// Fastify 类型扩展：把 compat / authStore / config 挂到 app 实例上
declare module 'fastify' {
  interface FastifyInstance {
    compat: Compat;
    authStore: AuthStore;
    config: { GATEWAY_PAIRING_PUBLIC: boolean; GATEWAY_PAIR_KEY?: string };
  }
}
