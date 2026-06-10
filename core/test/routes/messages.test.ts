// GET / POST /v1/sessions/{id}/messages 路由测试。
// v6.1：写 user + assistant 消息到 DB，调 OpenAI 兼容 LLM，返回两条消息。
// fetch 全局 mock，避免真网络。
import { describe, it, expect, beforeEach, afterEach, vi, afterAll } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '@/db/index.js';
import { AgentsDAO } from '@/db/agents.js';
import { SessionsDAO } from '@/db/sessions.js';
import { MessagesDAO } from '@/db/messages.js';
import { messageRoutes } from '@/routes/messages.js';
import { agentRoutes } from '@/routes/agents.js';
import { sessionRoutes } from '@/routes/sessions.js';
import { internalClientKeyHook } from '@/hooks/internal-client-key.js';
import { HttpError } from '@/errors.js';

const realFetch = global.fetch;
afterAll(() => {
  global.fetch = realFetch;
});

describe('routes /v1/sessions/:id/messages', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    const db = openDatabase(':memory:');
    const agents = new AgentsDAO(db);
    const sessions = new SessionsDAO(db);
    const messages = new MessagesDAO(db);
    app = Fastify();
    app.setErrorHandler((err: unknown, _req: FastifyRequest, reply: FastifyReply) => {
      if (err instanceof HttpError) {
        return reply.code(err.status).send({ data: null, code: err.status, message: err.code });
      }
      if ((err as Error).name === 'ZodError') {
        return reply.code(400).send({ data: null, code: 400, message: 'invalid_body' });
      }
      return reply.code(500).send({ data: null, code: 500, message: 'internal_error' });
    });
    (app as unknown as { agents: AgentsDAO }).agents = agents;
    (app as unknown as { sessions: SessionsDAO }).sessions = sessions;
    (app as unknown as { messages: MessagesDAO }).messages = messages;
    (app as unknown as { config: { LLM_API_KEY?: string | undefined } }).config = {
      LLM_API_KEY: undefined,
    };
    await app.register(internalClientKeyHook);
    await app.register(async (i: FastifyInstance) => {
      await agentRoutes(i);
      await sessionRoutes(i);
      await messageRoutes(i);
    });
  });

  afterEach(async () => {
    await app.close();
  });

  const seedAgentAndSession = async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: { 'x-internal-client-key': 'ck' },
      payload: { id: 'a-1', name: 'Echo', baseUrl: 'http://x/v1', model: 'm' },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { 'x-internal-client-key': 'ck' },
      payload: { id: 's-1', agentId: 'a-1' },
    });
  };

  describe('GET', () => {
    it('session 存在 + 无 messages → 200 + []', async () => {
      await seedAgentAndSession();
      const res = await app.inject({
        method: 'GET',
        url: '/v1/sessions/s-1/messages',
        headers: { 'x-internal-client-key': 'ck' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual([]);
    });

    it('session 不存在 → 404', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/sessions/nope/messages',
        headers: { 'x-internal-client-key': 'ck' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST', () => {
    it('调 LLM + 写 user/assistant messages + 200', async () => {
      await seedAgentAndSession();
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'echo back' } }] }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/s-1/messages',
        headers: { 'x-internal-client-key': 'ck' },
        payload: { id: randomUUID(), content: 'hi' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.userMessage.role).toBe('user');
      expect(body.data.userMessage.content).toBe('hi');
      expect(body.data.assistantMessage.role).toBe('assistant');
      expect(body.data.assistantMessage.content).toBe('echo back');

      // 验证 fetch 调通
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('http://x/v1/chat/completions');
      const reqBody = JSON.parse((init as RequestInit).body as string);
      expect(reqBody.messages).toEqual([{ role: 'user', content: 'hi' }]);
    });

    it('system_prompt → 拼到 messages 首条', async () => {
      await app.inject({
        method: 'POST',
        url: '/v1/agents',
        headers: { 'x-internal-client-key': 'ck' },
        payload: {
          id: 'a-1',
          name: 'Echo',
          baseUrl: 'http://x/v1',
          model: 'm',
          systemPrompt: 'be terse',
        },
      });
      await app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: { 'x-internal-client-key': 'ck' },
        payload: { id: 's-1', agentId: 'a-1' },
      });

      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      await app.inject({
        method: 'POST',
        url: '/v1/sessions/s-1/messages',
        headers: { 'x-internal-client-key': 'ck' },
        payload: { id: randomUUID(), content: 'hi' },
      });
      const [, init] = fetchMock.mock.calls[0]!;
      const reqBody = JSON.parse((init as RequestInit).body as string);
      expect(reqBody.messages[0]).toEqual({ role: 'system', content: 'be terse' });
    });

    it('session 不存在 → 404', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/nope/messages',
        headers: { 'x-internal-client-key': 'ck' },
        payload: { id: randomUUID(), content: 'hi' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('LLM upstream 5xx → 502 upstream_error', async () => {
      await seedAgentAndSession();
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'bad',
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/s-1/messages',
        headers: { 'x-internal-client-key': 'ck' },
        payload: { id: randomUUID(), content: 'hi' },
      });
      expect(res.statusCode).toBe(502);
      expect(res.json().message).toBe('upstream_error');
    });
  });
});
