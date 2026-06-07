// 网关鉴权中间件：白名单放行；其他路径验 X-Client-Key（SHA-256 比对）。
// 鉴权通过后挂 req.clientCtx = { id, name }，并 setImmediate 异步更新 last_seen_at。
// 鉴权失败统一 401，message 区分 missing_key / invalid_key（防枚举见 v3.md §5.6）。
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { sha256 } from './hash.js';
import { isPublicPath } from './public-paths.js';
import { err } from '../response.js';
import type { AuthStore } from './store.js';

declare module 'fastify' {
  interface FastifyRequest {
    clientCtx?: { id: string; name: string | null };
  }
  interface FastifyInstance {
    authStore: AuthStore;
  }
}

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addHook('onRequest', async (req, reply) => {
    if (isPublicPath(req.url)) {
      return;
    }

    const key = req.headers['x-client-key'];
    if (typeof key !== 'string' || key.length === 0) {
      return reply.code(401).send(err(401, 'missing_key'));
    }

    const hash = sha256(key);
    const client = app.authStore.findByHash(hash);
    if (!client) {
      return reply.code(401).send(err(401, 'invalid_key'));
    }

    req.clientCtx = { id: client.id, name: client.name };

    // fire-and-forget：响应先回，DB 写后台排队
    setImmediate(() => {
      try {
        app.authStore.updateLastSeen(client.id, Date.now());
      } catch (e) {
        app.log.warn({ err: e, clientId: client.id }, 'updateLastSeen failed');
      }
    });
  });
};

export const authMiddleware = fp(plugin, { name: 'auth-middleware' });
