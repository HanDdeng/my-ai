import type { FastifyInstance } from 'fastify';
import type { CoreClient } from '../clients/core.js';

export async function agentRoutes(app: FastifyInstance, core: CoreClient) {
  app.get('/v1/agents', async (_req, reply) => {
    const res = await core.forward('/v1/agents', { method: 'GET' });
    reply.code(res.statusCode);
    reply.send(await res.body.json());
  });
}
