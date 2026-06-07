// core 健康检查：纯 ok=true，不做依赖探测（避免 core 启动时阻塞）。
// 真实依赖健康度由外部 monitor 通过 /v1/agents 等业务接口间接观察。
// 返回 version 让 client 拿到 handshake 信息；schema 是 compat-matrix 协议版本（当前固定 1）。
//
// 注意：version 不再读 app.compat.version（启动时缓存），而是每次请求现场从
// .compat.generated.json 重新读。E2E 验证 MISMATCH 路径需要"改文件即生效"，
// 文件只有 ~50 字节，开销 < 1ms，可接受。
import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { parseCompat } from '../compat/load.js';

function loadSlicePath(): string {
  // 当前模块位于 core/src/routes/health.ts（dev）或 core/dist/routes/health.js（prod）。
  // 两种情况下 '../../.compat.generated.json' 都解析到 core/.compat.generated.json。
  return fileURLToPath(new URL('../../.compat.generated.json', import.meta.url));
}

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    // 启动时 loadCompat 已保证 app.compat 存在且合法；现场读失败时回退到启动时值。
    let version = app.compat.version;
    try {
      const slice = parseCompat(loadSlicePath());
      version = slice.version;
    } catch {
      // 文件被删/损坏：保留启动时的 fallback。生产场景几乎不会发生。
    }
    return {
      ok: true,
      service: 'core',
      version,
      schema: 1,
    };
  });
}
