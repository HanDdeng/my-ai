// 单轮 chat 路由：当前同步返回，session 由客户端传入，core 不持久化。
// 后续要做的事情：会话历史、上下文窗口、流式响应、tool 调用。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgentRegistry } from '../agent/registry.js';

// 请求体 schema：agent + session + 单条 user content。
const ChatBody = z.object({
  agentId: z.string().min(1),
  sessionId: z.string().min(1),
  content: z.string().min(1),
});

export async function chatRoutes(app: FastifyInstance, registry: AgentRegistry) {
  app.post('/v1/chat', async (req, reply) => {
    // 入参校验失败返回 400 + 详细错误，调用方容易定位问题。
    const parsed = ChatBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ ok: false, error: 'invalid_body', details: parsed.error.flatten() });
    }
    // agent 不存在时 404，而不是 500；提示前端给出明确指引。
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
