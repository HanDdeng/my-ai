import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { openDatabase } from '@/db/index.js';
import { AgentsDAO } from '@/db/agents.js';
import { SessionsDAO } from '@/db/sessions.js';
import { sessionItemRoutes } from '@/routes/session-item.js';
import { internalClientKeyHook } from '@/hooks/internal-client-key.js';
import { agentRoutes } from '@/routes/agents.js';
import { HttpError } from '@/errors.js';

describe('routes /v1/sessions/:id', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    const db = openDatabase(':memory:');
    const agents = new AgentsDAO(db);
    const sessions = new SessionsDAO(db);
    app = Fastify();
    app.setErrorHandler((err, _req, reply) => {
      if (err instanceof HttpError) {
        return reply.code(err.status).send({ data: null, code: err.status, message: err.code });
      }
      return reply.code(500).send({ data: null, code: 500, message: 'internal_error' });
    });
    (app as unknown as { agents: AgentsDAO }).agents = agents;
    (app as unknown as { sessions: SessionsDAO }).sessions = sessions;
    await app.register(internalClientKeyHook);
    await app.register(async i => {
      await agentRoutes(i);
      await sessionItemRoutes(i);
    });
  });

  afterEach(async () => {
    await app.close();
  });

  // 内部 helper：建 agent + session（避开 sessions 路由以减少 fixture 依赖）
  const seed = async (ck: string, sessionId = 's-1') => {
    await app.inject({
      method: 'POST', url: '/v1/agents',
      headers: { 'x-internal-client-key': ck },
      payload: { id: 'a-1', name: 'Echo', baseUrl: 'http://x/v1', model: 'm' },
    });
    (app as unknown as { sessions: SessionsDAO }).sessions.insert({
      id: sessionId, agent_id: 'a-1', client_key: ck, title: '',
      created_at: '2026-06-10T00:00:00.000Z', updated_at: '2026-06-10T00:00:00.000Z',
    });
  };

  it('GET 存在 → 200', async () => {
    await seed('ck-A');
    const res = await app.inject({
      method: 'GET', url: '/v1/sessions/s-1',
      headers: { 'x-internal-client-key': 'ck-B' },  // 跨 clientKey
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.clientKey).toBe('ck-A');
  });

  it('GET 不存在 → 404 session_not_found', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/sessions/nope',
      headers: { 'x-internal-client-key': 'ck' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toBe('session_not_found');
  });

  it('DELETE 存在 → 200 + 删行', async () => {
    await seed('ck-A');
    const res = await app.inject({
      method: 'DELETE', url: '/v1/sessions/s-1',
      headers: { 'x-internal-client-key': 'ck-B' },  // 跨 clientKey
    });
    expect(res.statusCode).toBe(200);
    const got = await app.inject({
      method: 'GET', url: '/v1/sessions/s-1',
      headers: { 'x-internal-client-key': 'ck' },
    });
    expect(got.statusCode).toBe(404);
  });
});
