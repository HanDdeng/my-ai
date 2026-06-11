// GET / POST /v1/sessions/{id}/messages。
// POST 调 OpenAI 兼容 LLM，写 user + assistant 两条消息，返回 { userMessage, assistantMessage }。
// GET 拉历史。session 不存在 404；LLM upstream 5xx 转 502 upstream_error。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { type AgentsDAO } from '../db/agents.js';
import { type SessionsDAO } from '../db/sessions.js';
import { type MessagesDAO, type MessageRow } from '../db/messages.js';
import { createLLMClient } from '../llm/index.js';
import { LLMUpstreamError } from '../llm/errors.js';
import { HttpError } from '../errors.js';

const PostMessageBody = z.object({
  id: z.string().min(1).max(64),
  content: z.string().min(1),
});

function rowToMessage(row: MessageRow) {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

export async function messageRoutes(app: FastifyInstance) {
  const agentsDao = (app as unknown as { agents: AgentsDAO }).agents;
  const sessionsDao = (app as unknown as { sessions: SessionsDAO }).sessions;
  const messagesDao = (app as unknown as { messages: MessagesDAO }).messages;
  const cfg = (app as unknown as { config: { LLM_API_KEY?: string } }).config;

  app.get('/v1/sessions/:id/messages', async req => {
    const { id } = req.params as { id: string };
    if (!sessionsDao.get(id)) {
      throw new HttpError(404, 'session_not_found');
    }
    const rows = messagesDao.listBySession(id);
    return { data: rows.map(rowToMessage), code: 0, message: 'ok' as const };
  });

  app.post('/v1/sessions/:id/messages', async (req, _reply) => {
    const { id: sid } = req.params as { id: string };
    const parsed = PostMessageBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_body');
    }

    const session = sessionsDao.get(sid);
    if (!session) {
      throw new HttpError(404, 'session_not_found');
    }
    const agent = agentsDao.get(session.agent_id);
    if (!agent) {
      throw new HttpError(404, 'agent_not_found');
    }

    const history = messagesDao.listBySession(sid);

    // 构造 LLM 客户端（每次新实例；v6.1 不缓存）
    const llm = createLLMClient(agent.llm_provider, {
      baseUrl: agent.base_url,
      apiKey: cfg.LLM_API_KEY,
      model: agent.model,
      maxTokens: agent.max_tokens ?? undefined,
    });

    const messages = [];
    if (agent.system_prompt) {
      messages.push({ role: 'system' as const, content: agent.system_prompt });
    }
    for (const m of history) {
      messages.push({ role: m.role, content: m.content });
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

    // 写 DB
    const now = new Date().toISOString();
    messagesDao.insert({
      id: parsed.data.id,
      session_id: sid,
      role: 'user',
      content: parsed.data.content,
      created_at: now,
    });
    const amId = randomUUID();
    messagesDao.insert({
      id: amId,
      session_id: sid,
      role: 'assistant',
      content: reply2.content,
      created_at: now,
    });
    sessionsDao.updateTimestamp(sid, now);

    return {
      data: {
        userMessage: {
          id: parsed.data.id,
          sessionId: sid,
          role: 'user',
          content: parsed.data.content,
          createdAt: now,
        },
        assistantMessage: {
          id: amId,
          sessionId: sid,
          role: 'assistant',
          content: reply2.content,
          createdAt: now,
        },
      },
      code: 0,
      message: 'ok' as const,
    };
  });
}
