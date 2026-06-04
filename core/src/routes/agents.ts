import type { FastifyInstance } from 'fastify';
import type { AgentRegistry } from '../agent/registry.js';

export async function agentRoutes(app: FastifyInstance, registry: AgentRegistry) {
  app.get('/v1/agents', async () => ({ items: registry.list() }));
}
