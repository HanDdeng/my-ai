// /pair/status：私有模式配对的轮询接口。
// PENDING / PAIRED / EXPIRED 三态；不存在 → 404。
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ok, err } from '../response.js';
import type { AuthStore } from '../auth/store.js';

declare module 'fastify' {
  interface FastifyInstance {
    authStore: AuthStore;
  }
}

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get<{ Querystring: { token?: string } }>('/pair/status', async (req, reply) => {
    const token = req.query.token;
    if (!token) {
      return reply.code(400).send(err(400, 'missing_token'));
    }
    const code = app.authStore.findPairingCode(token);
    if (!code) {
      return reply.code(404).send(err(404, 'token_not_found'));
    }
    const now = Date.now();
    if (code.expires_at < now) {
      return reply.send(ok({ status: 'EXPIRED' }));
    }
    // 若 client_id 已经在 clients 表里（CLI 已解析）→ PAIRED
    if (app.authStore.findByHash(code.client_id)) {
      return reply.send(ok({ status: 'PAIRED' }));
    }
    return reply.send(ok({ status: 'PENDING' }));
  });
};

export const pairStatusRoutes = plugin;
