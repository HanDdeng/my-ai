// POST /v1/chat：v1 同步 chat 路由（保留 + 标注后续 评估删除）。
// v6.1 重写：查 DB 拿 agent → 调 OpenAI 兼容客户端 → 返回 v1 AgentRunOutput 形态。
// v6.4: apiKey 优先用 agent.api_key，回退到 env LLM_API_KEY；
//   reasoningEffort 改由请求 body 传参（默认 'none'）；不再读 agent 行。
// 不依赖 core/src/agent/types.ts（已删）；返回类型内联定义。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type AgentsDAO } from '../db/agents.js';
import { createLLMClient } from '../llm/index.js';
import { LLMUpstreamError } from '../llm/errors.js';
import { HttpError } from '../errors.js';

const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

const ChatBody = z.object({
  agentId: z.string().min(1),
  sessionId: z.string().min(1),
  content: z.string().min(1),
  // v6.4: 思考强度从请求 body 传；默认 'none'（不思考）。
  reasoningEffort: z.enum(REASONING_EFFORTS).default('none').optional(),
});

export async function chatRoutes(app: FastifyInstance) {
  const agentsDao = (app as unknown as { agents: AgentsDAO }).agents;
  const cfg = (app as unknown as { config: { LLM_API_KEY?: string } }).config;

  app.post('/v1/chat', async req => {
    const parsed = ChatBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_body');
    }

    const agent = agentsDao.get(parsed.data.agentId);
    if (!agent) {
      throw new HttpError(404, 'agent_not_found');
    }

    const llm = createLLMClient(agent.llm_provider, {
      baseUrl: agent.base_url,
      // v6.4: per-agent 凭据优先；回退到 env LLM_API_KEY。
      apiKey: agent.api_key ?? cfg.LLM_API_KEY,
      model: agent.model,
      maxTokens: agent.max_tokens ?? undefined,
      // v6.4: 由请求 body 决定；默认 'none'。
      reasoningEffort: parsed.data.reasoningEffort ?? 'none',
    });

    const messages = [];
    if (agent.system_prompt) {
      messages.push({ role: 'system' as const, content: agent.system_prompt });
    }
    messages.push({ role: 'user' as const, content: parsed.data.content });

    let reply2;
    try {
      reply2 = await llm.chat({
        model: agent.model,
        messages,
        maxTokens: agent.max_tokens ?? undefined,
      });
    } catch (e) {
      if (e instanceof LLMUpstreamError) {
        app.log.error({ err: e }, 'LLM upstream error');
        throw new HttpError(502, 'upstream_error');
      }
      throw e;
    }

    return {
      agentId: parsed.data.agentId,
      sessionId: parsed.data.sessionId,
      reply: { role: 'assistant' as const, content: reply2.content },
      finishedAt: new Date().toISOString(),
    };
  });
}
