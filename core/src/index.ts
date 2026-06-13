// core 入口：装配 + 监听 + 优雅退出。
// 启动时同步加载 compat；失败直接退出。
import { loadConfig } from './config.js';
import { buildServer } from './server.js';
import { loadCompat } from './compat/load.js';
import { openDatabase } from './db/index.js';

let compat;
try {
  compat = loadCompat('core');
  // eslint-disable-next-line no-console
  console.log(
    `✓ core compat loaded: version=${compat.version}, upstream=${JSON.stringify(compat.upstream)}`,
  );
} catch (e) {
  console.error(`✖ core 启动失败: ${(e as Error).message}`);
  process.exit(1);
}

const cfg = loadConfig();

// 打开 SQLite（schema_version=1 起步；不匹配 loud fail）
let db;
try {
  db = openDatabase(cfg.CORE_DB_PATH);
} catch (e) {
  console.error(`✖ core 启动失败: ${(e as Error).message}`);
  process.exit(1);
}

const app = await buildServer(cfg, compat, db);

try {
  await app.listen({ host: cfg.HOST, port: cfg.PORT });
  app.log.info(`core listening on http://${cfg.HOST}:${cfg.PORT}`);
  app.log.info(`sqlite: ${cfg.CORE_DB_PATH}`);
} catch (err) {
  app.log.error(err, 'failed to start core');
  process.exit(1);
}

const shutdown = async (signal: string) => {
  app.log.info(`received ${signal}, shutting down`);
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
