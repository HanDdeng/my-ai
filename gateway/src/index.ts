// 网关入口：装配 + 监听 + 优雅退出。
// 启动时同步加载 compat；失败直接退出。
import { loadConfig } from './config.js';
import { buildServer } from './server.js';
import { loadCompat } from './compat/load.js';
import { openDatabase } from './db.js';
import { AuthStore } from './auth/store.js';

let compat;
try {
  compat = loadCompat('gateway');
  // eslint-disable-next-line no-console
  console.log(
    `✓ gateway compat loaded: version=${compat.version}, upstream=${JSON.stringify(compat.upstream)}`,
  );
} catch (e) {
  console.error(`✖ gateway 启动失败: ${(e as Error).message}`);
  process.exit(1);
}

const cfg = loadConfig();
// 持久层：打开 DB + 构造 AuthStore，buildServer 把它挂到 app 上供 middleware/routes 使用。
const authStore = new AuthStore(openDatabase(cfg.GATEWAY_DB_PATH));
const app = await buildServer(cfg, compat, authStore);

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
