// /internal/clients：CLI list 用的已配对客户端列表。
// 限 127.0.0.1；online = (now - last_seen_at) < 60s。
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ok, err } from '../../response.js';
import type { AuthStore } from '../../auth/store.js';

const ONLINE_THRESHOLD_MS = 60_000;

declare module 'fastify' {
  interface FastifyInstance {
    authStore: AuthStore;
  }
}

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/internal/clients', async (req, reply) => {
    if (req.ip !== '127.0.0.1' && req.ip !== '::1') {
      return reply.code(403).send(err(403, 'forbidden'));
    }
    const now = Date.now();
    const clients = app.authStore.listClients().map(c => ({
      id: c.id,
      name: c.name,
      created_at: c.created_at,
      last_seen_at: c.last_seen_at,
      online: now - c.last_seen_at < ONLINE_THRESHOLD_MS,
    }));
    return reply.send(ok(clients));
  });
};

export const clientsRoutes = plugin;
