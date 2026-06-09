// 网关健康检查：纯 ok=true，不做 core 探测（避免 core 抖动时误报网关挂掉）。
// 真实 core 健康度由外部 monitor 通过 /v1/agents 等业务接口间接观察。
// v3 起走新响应包装：{ data: {ok, service, version, schema}, code: 0, message: 'ok' }
import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { parseCompat } from '../compat/load.js';
import { ok } from '../response.js';

function loadSlicePath(): string {
  return fileURLToPath(new URL('../../.compat.generated.json', import.meta.url));
}

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    let version = app.compat.version;
    try {
      const slice = parseCompat(loadSlicePath());
      version = slice.version;
    } catch {
      // 现场读失败时回退到启动时值
    }
    return ok({ ok: true, service: 'gateway', version, schema: 1 });
  });
}
