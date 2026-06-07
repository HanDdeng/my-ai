// 核心健康检查：v3 起走新响应包装。
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
      // ignore
    }
    return ok({ ok: true, service: 'core', version, schema: 1 });
  });
}
