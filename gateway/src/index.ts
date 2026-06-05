// 网关入口：装配 + 监听 + 优雅退出。
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

const cfg = loadConfig();
const app = await buildServer(cfg);

try {
  await app.listen({ host: cfg.HOST, port: cfg.PORT });
  app.log.info(`gateway listening on http://${cfg.HOST}:${cfg.PORT}`);
  app.log.info(`core target: ${cfg.CORE_URL}`);
} catch (err) {
  app.log.error(err, 'failed to start gateway');
  process.exit(1);
}

// 收到信号时关闭 server 再退出，让 in-flight 请求有机会完成。
const shutdown = async (signal: string) => {
  app.log.info(`received ${signal}, shutting down`);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
