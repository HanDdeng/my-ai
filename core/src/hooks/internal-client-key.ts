// X-Internal-Client-Key 内部鉴权 hook：gateway 注入该 header。
// core 端拒绝缺失 → 抛 HttpError(401) → setErrorHandler 转 401 unauthorized。
// 提取后挂到 req.internalClientKey，供路由使用（写 sessions.client_key 等）。
// /health 路径免鉴权（gateway 自身 health check 不需 clientKey；spec §5.3.1）。
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { HttpError } from '../errors.js';

const PUBLIC_PATHS: ReadonlySet<string> = new Set(['/health']);

declare module 'fastify' {
  interface FastifyRequest {
    internalClientKey?: string;
  }
}

export const internalClientKeyHook = fp(async (app: FastifyInstance) => {
  app.addHook('onRequest', async (req: FastifyRequest) => {
    // 取路径（去掉 query string）；白名单跳过
    const path = req.url.split('?', 1)[0] ?? req.url;
    if (PUBLIC_PATHS.has(path)) {
      return;
    }

    const ck = req.headers['x-internal-client-key'];
    if (typeof ck !== 'string' || ck.length === 0) {
      throw new HttpError(401, 'unauthorized');
    }
    req.internalClientKey = ck;
  });
});
