// /pair：配对入口。决策表见 versions/v3.md §5.5。
// 公开模式：忽略 pairKey，直接配对。
// 私有模式：pairKey 匹配 → 配对；无/错 → 进入 code 流程（202 + token）。
// 幂等：POST /pair 前先按 sha256(clientKey) 查 DB，命中直接 200。
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { ok, err } from '../response.js';
import { sha256 } from '../auth/hash.js';
import type { AuthStore } from '../auth/store.js';

const PairBody = z.object({
  clientKey: z.string().min(1),
  name: z.string().nullable().optional(),
  pairKey: z.string().optional(),
});

// 5 分钟 TTL：与 v3.md §5.5 默认值一致；v4+ 抽到 config。
const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;

declare module 'fastify' {
  interface FastifyInstance {
    authStore: AuthStore;
    config: { GATEWAY_PAIRING_PUBLIC: boolean; GATEWAY_PAIR_KEY?: string };
  }
}

// 16 字节 base64url = 22 字符，URL safe，熵 ~96 bit。
function generateToken(): string {
  return randomBytes(16).toString('base64url');
}

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post('/pair', async (req, reply) => {
    const parsed = PairBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(err(400, 'invalid_body'));
    }
    const { clientKey, name = null, pairKey } = parsed.data;
    const hash = sha256(clientKey);
    const now = Date.now();

    // 幂等：已配对过 → 直接 200（按 sha256 命中）
    if (app.authStore.findByHash(hash)) {
      const existing = app.authStore.findByHash(hash)!;
      return reply.send(ok({ clientKey, name: existing.name }));
    }

    // 决策：是否直接配对
    const isPublic = app.config.GATEWAY_PAIRING_PUBLIC;
    const pairKeyValid =
      typeof pairKey === 'string' &&
      typeof app.config.GATEWAY_PAIR_KEY === 'string' &&
      pairKey === app.config.GATEWAY_PAIR_KEY;

    if (isPublic || pairKeyValid) {
      app.authStore.insertClient({
        id: hash,
        keyHash: hash,
        name,
        createdAt: now,
        lastSeenAt: now,
      });
      return reply.send(ok({ clientKey, name }));
    }

    // 私有 + 无/错 pairKey → 进入 code 流程（防枚举：无/错不区分）
    const token = generateToken();
    const expiresAt = now + PAIRING_CODE_TTL_MS;
    app.authStore.insertPairingCode({
      token,
      clientId: hash,
      clientName: name,
      expiresAt,
    });
    return reply
      .code(202)
      .send(ok({ token, expiresAt, pollUrl: `/pair/status?token=${token}` }, 'pair_pending'));
  });
};

export const pairRoutes = plugin;
