import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { openDatabase } from '@/db/index.js';
import { AgentsDAO } from '@/db/agents.js';
import { agentRoutes } from '@/routes/agents.js';
import { agentItemRoutes } from '@/routes/agent-item.js';
import { SessionsDAO } from '@/db/sessions.js';
import { HttpError } from '@/errors.js';

describe('routes /v1/agents/:id', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    const db = openDatabase(':memory:');
    const dao = new AgentsDAO(db);
    const sessionsDao = new SessionsDAO(db);
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
    (app as unknown as { agents: AgentsDAO }).agents = dao;
    (app as unknown as { sessions: SessionsDAO }).sessions = sessionsDao;
    await app.register(async (i: FastifyInstance) => {
      await agentItemRoutes(i);
    });
    await app.register(async (i: FastifyInstance) => {
      await agentRoutes(i);
    });
  });

  afterEach(async () => {
    await app.close();
  });

  const insertEcho = async (id = 'a-1', name = 'Echo') => {
    await app.inject({
      method: 'POST',
      url: '/v1/agents',
      payload: { id, name, baseUrl: 'http://x/v1', model: 'm' },
    });
  };

  it('GET /v1/agents/{id} 存在 → 200 + 完整 agent', async () => {
    await insertEcho();
    const res = await app.inject({ method: 'GET', url: '/v1/agents/a-1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.name).toBe('Echo');
  });

  it('GET 不存在 → 404 agent_not_found', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/agents/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toBe('agent_not_found');
  });

  it('PATCH 改 description → 持久化', async () => {
    await insertEcho();
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/agents/a-1',
      payload: { description: 'new' },
    });
    expect(res.statusCode).toBe(200);
    const got = await app.inject({ method: 'GET', url: '/v1/agents/a-1' });
    expect(got.json().data.description).toBe('new');
  });

  it('PATCH 不存在 → 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/agents/nope',
      payload: { description: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH 改 name 重复 → 409', async () => {
    await insertEcho('a-1', 'Echo');
    await insertEcho('a-2', 'Other');
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/agents/a-2',
      payload: { name: 'Echo' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('DELETE 存在 → 200 + 删行', async () => {
    await insertEcho();
    const res = await app.inject({ method: 'DELETE', url: '/v1/agents/a-1' });
    expect(res.statusCode).toBe(200);
    const got = await app.inject({ method: 'GET', url: '/v1/agents/a-1' });
    expect(got.statusCode).toBe(404);
  });

  it('DELETE 不存在 → 404', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/v1/agents/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE agent → CASCADE 删 sessions', async () => {
    await insertEcho();
    // 直接通过 DAO 插一个 session
    (app as unknown as { sessions: SessionsDAO }).sessions.insert({
      id: 's-1',
      agent_id: 'a-1',
      client_key: 'ck',
      title: '',
      created_at: '2026-06-10T00:00:00.000Z',
      updated_at: '2026-06-10T00:00:00.000Z',
    });
    await app.inject({ method: 'DELETE', url: '/v1/agents/a-1' });
    const s = (app as unknown as { sessions: SessionsDAO }).sessions.get('s-1');
    expect(s).toBeNull();
  });

  it('v6.3.1: PATCH contextWindow → 持久化', async () => {
    await insertEcho();
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/agents/a-1',
      payload: { contextWindow: 131072 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.contextWindow).toBe(131072);
    const got = (app as unknown as { agents: AgentsDAO }).agents.get('a-1');
    expect(got?.context_window).toBe(131072);
  });

  it('v6.4: PATCH contextWindow = null 落 4096（不再存 null）', async () => {
    await insertEcho();
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/agents/a-1',
      payload: { contextWindow: null },
    });
    expect(res.statusCode).toBe(200);
    // v6.4: null 视同"用默认"，统一落 4096。
    expect(res.json().data.contextWindow).toBe(4096);
  });

  it('v6.3.1: PATCH contextWindow 越界 → 400', async () => {
    await insertEcho();
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/agents/a-1',
      payload: { contextWindow: 2_000_001 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('v6.4: PATCH apiKey → 持久化', async () => {
    await insertEcho();
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/agents/a-1',
      payload: { apiKey: 'sk-test-medium' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.apiKey).toBe('sk-test-medium');
    const got = (app as unknown as { agents: AgentsDAO }).agents.get('a-1');
    expect(got?.api_key).toBe('sk-test-medium');
  });

  it('v6.4: PATCH apiKey = null 允许（清空）', async () => {
    await insertEcho();
    // 先设上
    await app.inject({
      method: 'PATCH',
      url: '/v1/agents/a-1',
      payload: { apiKey: 'sk-test-high' },
    });
    // 再清空
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/agents/a-1',
      payload: { apiKey: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.apiKey).toBeNull();
  });

  it('v6.4: PATCH apiKey 超过 512 字符 → 400', async () => {
    await insertEcho();
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/agents/a-1',
      payload: { apiKey: 'a'.repeat(513) },
    });
    expect(res.statusCode).toBe(400);
  });
});
