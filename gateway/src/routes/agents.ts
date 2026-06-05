// agent 列表路由：透传到 core /v1/agents。
// 后续可在此做多租户过滤、按用户能力裁剪可见 agent 等。
import type { FastifyInstance } from 'fastify';
import type { CoreClient } from '../clients/core.js';

export async function agentRoutes(app: FastifyInstance, core: CoreClient) {
  app.get('/v1/agents', async (_req, reply) => {
    const res = await core.forward('/v1/agents', { method: 'GET' });
    reply.code(res.statusCode);
    reply.send(await res.body.json());
  });
}
