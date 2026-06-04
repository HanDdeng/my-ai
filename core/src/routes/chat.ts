import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgentRegistry } from '../agent/registry.js';

const ChatBody = z.object({
  agentId: z.string().min(1),
  sessionId: z.string().min(1),
  content: z.string().min(1),
});

export async function chatRoutes(app: FastifyInstance, registry: AgentRegistry) {
  app.post('/v1/chat', async (req, reply) => {
    const parsed = ChatBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'invalid_body', details: parsed.error.flatten() });
    }
    const agent = registry.get(parsed.data.agentId);
    if (!agent) {
      return reply.code(404).send({ ok: false, error: 'agent_not_found' });
    }
    const out = await agent.run({
      agentId: parsed.data.agentId,
      sessionId: parsed.data.sessionId,
      message: { role: 'user', content: parsed.data.content },
    });
    return out;
  });
}
