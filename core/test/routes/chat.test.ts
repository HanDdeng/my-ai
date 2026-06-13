import { describe, it, expect, beforeEach, afterEach, vi, afterAll } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { openDatabase } from '@/db/index.js';
import { AgentsDAO } from '@/db/agents.js';
import { chatRoutes } from '@/routes/chat.js';
import { agentRoutes } from '@/routes/agents.js';
import { internalClientKeyHook } from '@/hooks/internal-client-key.js';
import { HttpError } from '@/errors.js';

const realFetch = global.fetch;
afterAll(() => {
  global.fetch = realFetch;
});

describe('routes POST /v1/chat (v1 compat)', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    const db = openDatabase(':memory:');
    const agents = new AgentsDAO(db);
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
    (
      app as unknown as {
        config: { LLM_API_KEY?: string | undefined; LLM_TIMEOUT_MS?: number };
      }
    ).config = {
      LLM_API_KEY: undefined,
    };
    // /v1/chat 是 v1 公共端点（v5 client 兼容），不走内部鉴权。
    // 内部 hook 只作用于 agentRoutes 所在的独立 context（直接调用 fp 函数，不走 register，
    // 这样 hook 只加到当前 context，不上浮到 app）。
    await app.register(async (i: FastifyInstance) => {
      await internalClientKeyHook(i);
      await agentRoutes(i);
    });
    await app.register(async (i: FastifyInstance) => {
      await chatRoutes(i);
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('v1 schema → 200 + AgentRunOutput 形态', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: { 'x-internal-client-key': 'ck' },
      payload: { id: 'a-1', name: 'Echo', baseUrl: 'http://x/v1', model: 'm' },
    });

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'back' } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { agentId: 'a-1', sessionId: 's-legacy', content: 'hi' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // v1 AgentRunOutput 形态：{ agentId, sessionId, reply: { role, content }, finishedAt }
    expect(body.agentId).toBe('a-1');
    expect(body.sessionId).toBe('s-legacy');
    expect(body.reply).toEqual({ role: 'assistant', content: 'back' });
    expect(typeof body.finishedAt).toBe('string');
  });

  it('agentId 不存在 → 404 agent_not_found', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { agentId: 'nope', sessionId: 's', content: 'hi' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toBe('agent_not_found');
  });

  it('缺必填字段 → 400 invalid_body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { agentId: 'a' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('v6.5: chat 路由透传 cfg.LLM_TIMEOUT_MS 到 LLM client (AbortSignal.timeout)', async () => {
    // 准备 agent（POST /v1/agents）
    await app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: { 'x-internal-client-key': 'ck' },
      payload: { id: 'a-tm', name: 'tm-agent', baseUrl: 'http://x/v1', model: 'm' },
    });

    // 设定 LLM_TIMEOUT_MS sentinel：999_999 与任何 default 都不撞。
    (
      app as unknown as { config: { LLM_API_KEY?: string; LLM_TIMEOUT_MS?: number } }
    ).config.LLM_TIMEOUT_MS = 999_999;

    // spy AbortSignal.timeout：openai-compatible.ts 在 fetch 时调
    //   signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 600_000)
    // 捕获所有入参，第一个非 undefined 的数值就是 timeoutMs 透传值。
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');

    // mock fetch 返回 200 + 一个 LLM reply
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { agentId: 'a-tm', sessionId: 's-tm', content: 'hi' },
    });
    expect(res.statusCode).toBe(200);

    // 断言 AbortSignal.timeout 被以 999_999 调用过 → cfg.LLM_TIMEOUT_MS 真到了 LLM client。
    const calls = timeoutSpy.mock.calls.filter(c => typeof c[0] === 'number');
    expect(calls.some(c => c[0] === 999_999)).toBe(true);

    timeoutSpy.mockRestore();
  });
});
