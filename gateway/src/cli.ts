// my-ai-gateway CLI 入口：start / pair --token / list 三个子命令。
// start：等价于 node dist/index.js（向后兼容 v2 启动方式）
// pair：调 /internal/pair/resolve 完成私有模式配对码解析
// list：调 /internal/clients 看已配对客户端
/* eslint-disable no-console -- CLI 工具，全部输出走 console */
import { request } from 'undici';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';
import { openDatabase } from './db.js';
import { AuthStore } from './auth/store.js';
import { parseCompat } from './compat/load.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const COMPAT_PATH = fileURLToPath(new URL('../.compat.generated.json', import.meta.url));

function getGatewayBaseUrl(): string {
  const cfg = loadConfig();
  return `http://127.0.0.1:${cfg.PORT}`;
}

export async function cmdStart(): Promise<void> {
  const cfg = loadConfig();
  const compat = parseCompat(COMPAT_PATH);
  const authStore = new AuthStore(openDatabase(cfg.GATEWAY_DB_PATH));
  const app = await buildServer(cfg, compat, authStore);
  await app.listen({ port: cfg.PORT, host: cfg.HOST });
}

async function cmdPair(token: string): Promise<void> {
  const base = getGatewayBaseUrl();
  const res = await request(`${base}/internal/pair/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (res.statusCode === 200) {
    console.log('✅ 已配对');
    return;
  }
  const body = (await res.body.json().catch(() => ({}))) as { message?: string };
  console.error(`❌ 解析失败: ${body.message ?? res.statusCode}`);
  process.exit(1);
}

async function cmdList(): Promise<void> {
  const base = getGatewayBaseUrl();
  const res = await request(`${base}/internal/clients`);
  if (res.statusCode !== 200) {
    console.error(`❌ 网关不可达 (${res.statusCode})`);
    process.exit(2);
  }
  const body = (await res.body.json()) as {
    data: Array<{
      name: string | null;
      id: string;
      created_at: number;
      last_seen_at: number;
      online: boolean;
    }>;
  };
  if (body.data.length === 0) {
    console.log('（暂无已配对客户端）');
    return;
  }
  console.log('NAME                ID         CREATED              LAST_SEEN            ONLINE');
  for (const c of body.data) {
    const name = (c.name ?? '(未命名)').padEnd(20).slice(0, 20);
    const id = c.id.slice(0, 8).padEnd(10);
    const created = new Date(c.created_at).toISOString().slice(0, 19).padEnd(20);
    const last = new Date(c.last_seen_at).toISOString().slice(0, 19).padEnd(20);
    const online = c.online ? '🟢' : '⚫';
    console.log(`${name} ${id} ${created} ${last} ${online}`);
  }
}

function parseArgs(argv: string[]): { cmd: string; opts: Record<string, string> } {
  const [cmd, ...rest] = argv;
  const opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg) {
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const val = rest[i + 1];
      if (val && !val.startsWith('--')) {
        opts[key] = val;
        i++;
      } else {
        opts[key] = 'true';
      }
    }
  }
  return { cmd: cmd ?? 'start', opts };
}

async function main(): Promise<void> {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  switch (cmd) {
    case 'start':
      await cmdStart();
      break;
    case 'pair': {
      const token = opts.token;
      if (!token) {
        console.error('用法: my-ai-gateway pair --token <token>');
        process.exit(1);
      }
      await cmdPair(token);
      break;
    }
    case 'list':
      await cmdList();
      break;
    default:
      console.error(`未知子命令: ${cmd}（start | pair | list）`);
      process.exit(1);
  }
}

// 仅当 cli.ts 作为入口运行（pnpm start / my-ai-gateway bin / node dist/cli.js）时才执行 main()；
// 被 src/index.ts shim 导入时不触发，避免 index.ts 自身调 cmdStart() + cli.ts 顶层 main() 默认 dispatch 到 start 双 listen → EADDRINUSE。
// 模式与 scripts/sync-compat.mjs:66 一致。
const isMain = (() => {
  try {
    const modulePath = fileURLToPath(import.meta.url);
    const argvPath = resolve(process.argv[1] ?? '');
    return modulePath === argvPath;
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
