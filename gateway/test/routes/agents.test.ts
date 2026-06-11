// /v1/agents 路由层单测：5 端点（GET 列表 / POST / GET-id / PATCH / DELETE）+ 错误码透传矩阵。
// 用 app.decorate('core', mockCore) 注入假 CoreClient；不真实发请求。
import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDatabase } from '@/db.js';
import { AuthStore } from '@/auth/store.js';
import { sha256 } from '@/auth/hash.js';
import { authMiddleware } from '@/auth/middleware.js';
import { agentRoutes } from '@/routes/agents.js';
import type { CoreClient } from '@/clients/core.js';

type CoreResponse = { status: number; data: unknown };

// 包装函数：vitest 2.x 的 vi 不能直接 vi(fn) 调用；必须 vi.fn().mockImplementation(fn)。
function mockImpl<T extends (...args: never[]) => unknown>(fn: T) {
  return vi.fn().mockImplementation(fn);
}

function buildMockCore(responses: Record<string, CoreResponse> = {}): CoreClient {
  return {
    listAgents: mockImpl(async (_ck: string) => responses.listAgents ?? { status: 200, data: [] }),
    createAgent: mockImpl(
      async (_ck: string, _body: unknown) =>
        responses.createAgent ?? { status: 200, data: { id: 'new' } },
    ),
    getAgent: mockImpl(
      async (_ck: string, _id: string) => responses.getAgent ?? { status: 200, data: { id: 'a1' } },
    ),
    updateAgent: mockImpl(
      async (_ck: string, _id: string, _body: unknown) =>
        responses.updateAgent ?? { status: 200, data: { id: 'a1' } },
    ),
    deleteAgent: mockImpl(
      async (_ck: string, _id: string) => responses.deleteAgent ?? { status: 200, data: null },
    ),
    createSession: mockImpl(async () => ({ status: 200, data: null })),
    getSession: mockImpl(async () => ({ status: 200, data: null })),
    deleteSession: mockImpl(async () => ({ status: 200, data: null })),
    listMessages: mockImpl(async () => ({ status: 200, data: [] })),
    postMessage: mockImpl(async () => ({ status: 200, data: null })),
    health: mockImpl(async () => ({ ok: true, service: 'core' })),
  } as unknown as CoreClient;
}

async function buildApp(
  core: CoreClient,
): Promise<{ app: FastifyInstance; store: AuthStore; ckHeader: string }> {
  const store = new AuthStore(openDatabase(':memory:'));
  // v3 现状事实：id 字段就是 sha256 hash（auth/store.ts:92-96 + middleware.ts:31-37）。
  // 中间件 hash = sha256(headerKey)，再 findByHash(hash) → WHERE id = hash。
  // 所以插入时 id = sha256(headerKey) 才能被中间件查到。
  const ck = 'test-sha256-hash';
  const id = sha256(ck);
  store.insertClient({
    id,
    keyHash: id,
    name: 'tester',
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
  });

  const app = Fastify({ logger: false });
  app.decorate('core', core);
  app.decorate('authStore', store);
  await app.register(authMiddleware);
  await app.register(async instance => {
    await agentRoutes(instance, core);
  });
  return { app, store, ckHeader: ck };
}

describe('/v1/agents routes', () => {
  it('GET /v1/agents：200 + 透传 core.data', async () => {
    const core = buildMockCore({ listAgents: { status: 200, data: [{ id: 'a1' }] } });
    const { app, ckHeader } = await buildApp(core);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/agents',
      headers: { 'x-client-key': ckHeader },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [{ id: 'a1' }], code: 0, message: 'ok' });
  });

  it('POST /v1/agents：200 + 透传 core.data', async () => {
    const core = buildMockCore({
      createAgent: { status: 200, data: { id: 'a-new', name: 'New' } },
    });
    const { app, ckHeader } = await buildApp(core);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: { 'x-client-key': ckHeader, 'content-type': 'application/json' },
      payload: { id: 'a-new', name: 'New' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { id: 'a-new', name: 'New' }, code: 0, message: 'ok' });
  });

  it('GET /v1/agents/{id}：200 + 透传 core.data', async () => {
    const core = buildMockCore({ getAgent: { status: 200, data: { id: 'a1', name: 'Echo' } } });
    const { app, ckHeader } = await buildApp(core);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/agents/a1',
      headers: { 'x-client-key': ckHeader },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { id: 'a1', name: 'Echo' }, code: 0, message: 'ok' });
  });

  it('PATCH /v1/agents/{id}：200 + 透传 core.data', async () => {
    const core = buildMockCore({
      updateAgent: { status: 200, data: { id: 'a1', name: 'Renamed' } },
    });
    const { app, ckHeader } = await buildApp(core);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/agents/a1',
      headers: { 'x-client-key': ckHeader, 'content-type': 'application/json' },
      payload: { name: 'Renamed' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { id: 'a1', name: 'Renamed' }, code: 0, message: 'ok' });
  });

  it('DELETE /v1/agents/{id}：200 + 透传 core.data', async () => {
    const core = buildMockCore({ deleteAgent: { status: 200, data: null } });
    const { app, ckHeader } = await buildApp(core);
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/agents/a1',
      headers: { 'x-client-key': ckHeader },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: null, code: 0, message: 'ok' });
  });

  it('错误码透传：core 4xx 整包透传（status + data）', async () => {
    const core = buildMockCore({ getAgent: { status: 404, data: null } });
    const { app, ckHeader } = await buildApp(core);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/agents/missing',
      headers: { 'x-client-key': ckHeader },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().data).toBeNull();
  });

  it('错误码透传：core 5xx 整包透传', async () => {
    const core = buildMockCore({ getAgent: { status: 502, data: null } });
    const { app, ckHeader } = await buildApp(core);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/agents/missing',
      headers: { 'x-client-key': ckHeader },
    });
    expect(res.statusCode).toBe(502);
  });

  it('gateway 网络层异常 → 502 upstream_error', async () => {
    const core = {
      getAgent: mockImpl(async () => {
        throw new Error('ECONNREFUSED');
      }),
    } as unknown as CoreClient;
    const { app, ckHeader } = await buildApp(core);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/agents/a1',
      headers: { 'x-client-key': ckHeader },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ data: null, code: 502, message: 'upstream_error' });
  });

  it('鉴权失败：无 X-Client-Key → 401 missing_key，**不**调 core', async () => {
    const core = buildMockCore();
    const { app } = await buildApp(core);
    const res = await app.inject({ method: 'GET', url: '/v1/agents' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ data: null, code: 401, message: 'missing_key' });
  });
});
