// gateway 透传 /v1/agents 到 core；v3 起走新响应包装。
import type { FastifyInstance } from 'fastify';
import { ok, err } from '../response.js';
import type { CoreClient } from '../clients/core.js';

export async function agentRoutes(app: FastifyInstance, core: CoreClient) {
  app.get('/v1/agents', async (req, reply) => {
    try {
      const result = await core.listAgents(req.clientCtx!.id);
      return reply.send(ok(result));
    } catch (e) {
      req.log.error({ err: e }, 'listAgents failed');
      return reply.code(502).send(err(502, 'upstream_error'));
    }
  });
}
