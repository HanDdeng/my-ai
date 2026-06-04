import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { Config } from './config.js';
import { createLogger } from './logger.js';
import { createLLMClient } from './llm/index.js';
import { AgentRegistry } from './agent/registry.js';
import { EchoAgent } from './agent/echo.js';
import { healthRoutes } from './routes/health.js';
import { agentRoutes } from './routes/agents.js';
import { chatRoutes } from './routes/chat.js';

export async function buildServer(cfg: Config) {
  const app = Fastify({ logger: createLogger(cfg.LOG_LEVEL) });

  const origins = cfg.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  await app.register(cors, { origin: origins, credentials: true });
  await app.register(websocket);

  const llm = createLLMClient(cfg);
  const registry = new AgentRegistry();
  registry.register(new EchoAgent(llm));

  app.decorate('registry', registry);

  await app.register(async (instance) => {
    await healthRoutes(instance);
    await agentRoutes(instance, registry);
    await chatRoutes(instance, registry);
  });

  app.setErrorHandler((err, _req, reply) => {
    app.log.error({ err }, 'unhandled error');
    reply.code(500).send({ ok: false, error: 'internal_error' });
  });

  return app;
}
