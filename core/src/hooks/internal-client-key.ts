// X-Internal-Client-Key 内部鉴权 hook：gateway 注入该 header。
// core 端拒绝缺失 → 抛 HttpError(401) → setErrorHandler 转 401 unauthorized。
// 提取后挂到 req.internalClientKey，供路由使用（写 sessions.client_key 等）。
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { HttpError } from '../errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    internalClientKey?: string;
  }
}

export const internalClientKeyHook = fp(async (app: FastifyInstance) => {
  app.addHook('onRequest', async (req: FastifyRequest) => {
    const ck = req.headers['x-internal-client-key'];
    if (typeof ck !== 'string' || ck.length === 0) {
      throw new HttpError(401, 'unauthorized');
    }
    req.internalClientKey = ck;
  });
});
