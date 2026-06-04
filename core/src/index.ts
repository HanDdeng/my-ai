import { loadConfig } from './config.js';
import { buildServer } from './server.js';

const cfg = loadConfig();
const app = await buildServer(cfg);

try {
  await app.listen({ host: cfg.HOST, port: cfg.PORT });
  app.log.info(`core listening on http://${cfg.HOST}:${cfg.PORT}`);
  app.log.info(`llm provider: ${cfg.LLM_PROVIDER} model: ${cfg.LLM_MODEL}`);
} catch (err) {
  app.log.error(err, 'failed to start core');
  process.exit(1);
}

const shutdown = async (signal: string) => {
  app.log.info(`received ${signal}, shutting down`);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
