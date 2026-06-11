// /v1/agents 路由层单测：5 端点（GET 列表 / POST / GET-id / PATCH / DELETE）+ 错误码透传矩阵。
// 用 app.decorate('core', mockCore) 注入假 CoreClient；不真实发请求。
// v6.2 (Option B)：mockCore 返回 { status, body: <core 整包> }；2xx 时 handler 解 .data 包 ok()，
// 4xx/5xx 时 handler 真透传 core body。
import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDatabase } from '@/db.js';
import { AuthStore } from '@/auth/store.js';
import { sha256 } from '@/auth/hash.js';
import { authMiddleware } from '@/auth/middleware.js';
import { agentRoutes } from '@/routes/agents.js';
import type { CoreClient } from '@/clients/core.js';

// 2xx 包一个完整 success 整包；4xx/5xx 包一个完整 error 整包
type CoreResponse = { status: number; body: unknown };

// 包装函数：vitest 2.x 的 vi 不能直接 vi(fn) 调用；必须 vi.fn().mockImplementation(fn)。
function mockImpl<T extends (...args: never[]) => unknown>(fn: T) {
  return vi.fn().mockImplementation(fn);
}

// 工厂：默认每个方法回 2xx + 整包 success；测试可传入 responses 覆盖。
function buildMockCore(responses: Record<string, CoreResponse> = {}): CoreClient {
  const ok = (data: unknown): CoreResponse => ({
    status: 200,
    body: { data, code: 0, message: 'ok' },
  });
  return {
    listAgents: mockImpl(async (_ck: string) => responses.listAgents ?? ok([])),
    createAgent: mockImpl(
      async (_ck: string, _body: unknown) => responses.createAgent ?? ok({ id: 'new' }),
    ),
    getAgent: mockImpl(async (_ck: string, _id: string) => responses.getAgent ?? ok({ id: 'a1' })),
    updateAgent: mockImpl(
      async (_ck: string, _id: string, _body: unknown) => responses.updateAgent ?? ok({ id: 'a1' }),
    ),
    deleteAgent: mockImpl(async (_ck: string, _id: string) => responses.deleteAgent ?? ok(null)),
    createSession: mockImpl(async () => ok(null)),
    getSession: mockImpl(async () => ok(null)),
    deleteSession: mockImpl(async () => ok(null)),
    listMessages: mockImpl(async () => ok([])),
    postMessage: mockImpl(async () => ok(null)),
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
  it('GET /v1/agents：200 + 解 core.data 包 ok()', async () => {
    const core = buildMockCore({
      listAgents: { status: 200, body: { data: [{ id: 'a1' }], code: 0, message: 'ok' } },
    });
    const { app, ckHeader } = await buildApp(core);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/agents',
      headers: { 'x-client-key': ckHeader },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [{ id: 'a1' }], code: 0, message: 'ok' });
  });

  it('POST /v1/agents：200 + 解 core.data 包 ok()', async () => {
    const core = buildMockCore({
      createAgent: {
        status: 200,
        body: { data: { id: 'a-new', name: 'New' }, code: 0, message: 'ok' },
      },
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

  it('GET /v1/agents/{id}：200 + 解 core.data 包 ok()', async () => {
    const core = buildMockCore({
      getAgent: { status: 200, body: { data: { id: 'a1', name: 'Echo' }, code: 0, message: 'ok' } },
    });
    const { app, ckHeader } = await buildApp(core);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/agents/a1',
      headers: { 'x-client-key': ckHeader },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { id: 'a1', name: 'Echo' }, code: 0, message: 'ok' });
  });

  it('PATCH /v1/agents/{id}：200 + 解 core.data 包 ok()', async () => {
    const core = buildMockCore({
      updateAgent: {
        status: 200,
        body: { data: { id: 'a1', name: 'Renamed' }, code: 0, message: 'ok' },
      },
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

  it('DELETE /v1/agents/{id}：200 + 解 core.data 包 ok()', async () => {
    const core = buildMockCore({
      deleteAgent: { status: 200, body: { data: null, code: 0, message: 'ok' } },
    });
    const { app, ckHeader } = await buildApp(core);
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/agents/a1',
      headers: { 'x-client-key': ckHeader },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: null, code: 0, message: 'ok' });
  });

  it('错误码透传：core 4xx 整包透传（status + body 真透传）', async () => {
    const core = buildMockCore({
      getAgent: {
        status: 404,
        body: { data: null, code: 404, message: 'agent_not_found' },
      },
    });
    const { app, ckHeader } = await buildApp(core);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/agents/missing',
      headers: { 'x-client-key': ckHeader },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ data: null, code: 404, message: 'agent_not_found' });
  });

  it('错误码透传：core 5xx 整包透传（status + body 真透传）', async () => {
    const core = buildMockCore({
      getAgent: {
        status: 502,
        body: { data: null, code: 502, message: 'upstream_error' },
      },
    });
    const { app, ckHeader } = await buildApp(core);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/agents/missing',
      headers: { 'x-client-key': ckHeader },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ data: null, code: 502, message: 'upstream_error' });
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
