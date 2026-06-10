// POST /v1/sessions 路由测试：建 session 写 client_key；404/401/400 边界。
// v6.1 改造：sessions 入 DB；clientKey 从 X-Internal-Client-Key header 写。
//
// 注：spec 给的测试只注册 sessionRoutes + internalClientKeyHook，但第一个 case
// 调用 POST /v1/agents。Task 17 我沿用 Task 16 的修法：也注册 agentRoutes 让
// happy path 可行（与 plan §17 "Deviation note" 一致）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { openDatabase } from '@/db/index.js';
import { AgentsDAO } from '@/db/agents.js';
import { SessionsDAO } from '@/db/sessions.js';
import { sessionRoutes } from '@/routes/sessions.js';
import { agentRoutes } from '@/routes/agents.js';
import { internalClientKeyHook } from '@/hooks/internal-client-key.js';
import { HttpError } from '@/errors.js';

describe('routes POST /v1/sessions', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    const db = openDatabase(':memory:');
    const dao = new AgentsDAO(db);
    const sessionsDao = new SessionsDAO(db);
    app = Fastify();
    app.setErrorHandler((err, _req, reply) => {
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
    await app.register(internalClientKeyHook);
    // 偏离 spec：注册 agentRoutes 以便 happy path 能 POST /v1/agents 建 agent。
    await app.register(async i => { await agentRoutes(i); });
    await app.register(async i => { await sessionRoutes(i); });
  });

  afterEach(async () => {
    await app.close();
  });

  it('合法 body → 200 + 写 clientKey', async () => {
    await app.inject({
      method: 'POST', url: '/v1/agents',
      headers: { 'x-internal-client-key': 'ck' },
      payload: { id: 'a-1', name: 'Echo', baseUrl: 'http://x/v1', model: 'm' },
    });

    const res = await app.inject({
      method: 'POST', url: '/v1/sessions',
      headers: { 'x-internal-client-key': 'client-abc' },
      payload: { id: 's-1', agentId: 'a-1' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.code).toBe(0);
    expect(body.data.agentId).toBe('a-1');
    // 验证 clientKey 写入（建表时已配 FK；DAO get 看）
    const got = (app as unknown as { sessions: SessionsDAO }).sessions.get('s-1');
    expect(got?.client_key).toBe('client-abc');
  });

  it('agentId 不存在 → 404 agent_not_found', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/sessions',
      headers: { 'x-internal-client-key': 'ck' },
      payload: { id: 's-1', agentId: 'nope' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toBe('agent_not_found');
  });

  it('缺 internal-client-key → 401 unauthorized', async () => {
    await app.inject({
      method: 'POST', url: '/v1/agents',
      headers: { 'x-internal-client-key': 'ck' },
      payload: { id: 'a-1', name: 'Echo', baseUrl: 'http://x/v1', model: 'm' },
    });
    const res = await app.inject({
      method: 'POST', url: '/v1/sessions',
      payload: { id: 's-1', agentId: 'a-1' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().message).toBe('unauthorized');
  });

  it('body 缺字段 → 400 invalid_body', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/sessions',
      headers: { 'x-internal-client-key': 'ck' },
      payload: { id: 's-1' },  // 缺 agentId
    });
    expect(res.statusCode).toBe(400);
  });
});
