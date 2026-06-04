import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { Config } from './config.js';
import { createLogger } from './logger.js';
import { CoreClient } from './clients/core.js';
import { healthRoutes } from './routes/health.js';
import { agentRoutes } from './routes/agents.js';

export async function buildServer(cfg: Config) {
  const app = Fastify({ logger: createLogger(cfg.LOG_LEVEL) });

  const origins = cfg.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  await app.register(cors, { origin: origins, credentials: true });
  await app.register(websocket);

  const core = new CoreClient({ baseUrl: cfg.CORE_URL });
  app.decorate('core', core);

  await app.register(async (instance) => {
    await healthRoutes(instance, core);
    await agentRoutes(instance, core);
  });

  app.setErrorHandler((err, _req, reply) => {
    app.log.error({ err }, 'unhandled error');
    reply.code(500).send({ ok: false, error: 'internal_error' });
  });

  return app;
}
