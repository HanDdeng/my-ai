// core 端的 agents 列表端点。v3 起走新响应包装。
import type { FastifyInstance } from 'fastify';
import { ok } from '../response.js';
import type { AgentRegistry } from '../agent/registry.js';

export async function agentRoutes(app: FastifyInstance, registry: AgentRegistry) {
  app.get('/v1/agents', async () => {
    return ok(registry.list());
  });
}
