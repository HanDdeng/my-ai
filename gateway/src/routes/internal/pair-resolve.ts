// /internal/pair/resolve：CLI 调用的私有模式配对码解析端点。
// 限 127.0.0.1（防外部直接打）；错误尝试 3 次封禁。
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../../response.js';
import type { AuthStore } from '../../auth/store.js';

const Body = z.object({ token: z.string().min(1) });
const MAX_ATTEMPTS = 3;

declare module 'fastify' {
  interface FastifyInstance {
    authStore: AuthStore;
  }
}

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post('/internal/pair/resolve', async (req, reply) => {
    if (req.ip !== '127.0.0.1' && req.ip !== '::1') {
      return reply.code(403).send(err(403, 'forbidden'));
    }
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(err(400, 'invalid_body'));
    }
    const code = app.authStore.findPairingCode(parsed.data.token);
    if (!code) {
      return reply.code(404).send(err(404, 'token_not_found'));
    }
    if (code.expires_at < Date.now()) {
      app.authStore.deletePairingCode(parsed.data.token);
      return reply.code(404).send(err(404, 'token_not_found'));
    }
    if (code.attempts >= MAX_ATTEMPTS) {
      app.authStore.deletePairingCode(parsed.data.token);
      return reply.code(404).send(err(404, 'token_not_found'));
    }
    // attempts++ 直至 ≥ 3 后下一次拒绝
    app.authStore.incrementAttempts(parsed.data.token);
    if (code.attempts + 1 >= MAX_ATTEMPTS) {
      // 累计达上限：删 token + 404（不再 commit）
      app.authStore.deletePairingCode(parsed.data.token);
      return reply.code(404).send(err(404, 'token_not_found'));
    }
    // 解析成功：写入 clients + 删 pairing_code
    app.authStore.commitPairingCode(parsed.data.token, Date.now());
    return reply.send(ok(null, 'paired'));
  });
};

export const pairResolveRoutes = plugin;
