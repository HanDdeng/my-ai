// /v1/sessions 路由层单测：3 端点（POST / GET-id / DELETE）+ 错误码透传矩阵。
// 用 app.decorate('core', mockCore) 注入假 CoreClient；不真实发请求。
import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDatabase } from '@/db.js';
import { AuthStore } from '@/auth/store.js';
import { sha256 } from '@/auth/hash.js';
import { authMiddleware } from '@/auth/middleware.js';
import { sessionRoutes } from '@/routes/sessions.js';
import type { CoreClient } from '@/clients/core.js';

type CoreResponse = { status: number; data: unknown };

// 包装函数：vitest 2.x 的 vi 不能直接 vi(fn) 调用；必须 vi.fn().mockImplementation(fn)。
function mockImpl<T extends (...args: never[]) => unknown>(fn: T) {
  return vi.fn().mockImplementation(fn);
}

function buildMockCore(responses: Record<string, CoreResponse> = {}): CoreClient {
  return {
    listAgents: mockImpl(async () => ({ status: 200, data: [] })),
    createAgent: mockImpl(async () => ({ status: 200, data: null })),
    getAgent: mockImpl(async () => ({ status: 200, data: null })),
    updateAgent: mockImpl(async () => ({ status: 200, data: null })),
    deleteAgent: mockImpl(async () => ({ status: 200, data: null })),
    createSession: mockImpl(
      async (_ck: string, _b: unknown) =>
        responses.createSession ?? { status: 200, data: { id: 's1', agentId: 'a1' } },
    ),
    getSession: mockImpl(
      async (_ck: string, _id: string) =>
        responses.getSession ?? { status: 200, data: { id: 's1' } },
    ),
    deleteSession: mockImpl(
      async (_ck: string, _id: string) => responses.deleteSession ?? { status: 200, data: null },
    ),
    listMessages: mockImpl(async () => ({ status: 200, data: [] })),
    postMessage: mockImpl(async () => ({ status: 200, data: null })),
    health: mockImpl(async () => ({ ok: true, service: 'core' })),
  } as unknown as CoreClient;
}

async function buildApp(core: CoreClient): Promise<{ app: FastifyInstance; ckHeader: string }> {
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
    await sessionRoutes(instance, core);
  });
  return { app, ckHeader: ck };
}

describe('/v1/sessions routes', () => {
  it('POST /v1/sessions：200 + 透传 core.data', async () => {
    const core = buildMockCore({
      createSession: { status: 200, data: { id: 's1', agentId: 'a1' } },
    });
    const { app, ckHeader } = await buildApp(core);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { 'x-client-key': ckHeader, 'content-type': 'application/json' },
      payload: { id: 's1', agentId: 'a1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { id: 's1', agentId: 'a1' }, code: 0, message: 'ok' });
  });

  it('GET /v1/sessions/{id}：200 + 透传 core.data', async () => {
    const core = buildMockCore({ getSession: { status: 200, data: { id: 's1', agentId: 'a1' } } });
    const { app, ckHeader } = await buildApp(core);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions/s1',
      headers: { 'x-client-key': ckHeader },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { id: 's1', agentId: 'a1' }, code: 0, message: 'ok' });
  });

  it('DELETE /v1/sessions/{id}：200 + 透传 core.data', async () => {
    const core = buildMockCore({ deleteSession: { status: 200, data: null } });
    const { app, ckHeader } = await buildApp(core);
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/sessions/s1',
      headers: { 'x-client-key': ckHeader },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: null, code: 0, message: 'ok' });
  });

  it('错误码透传：core 404 session_not_found 整包透传', async () => {
    const core = buildMockCore({ getSession: { status: 404, data: null } });
    const { app, ckHeader } = await buildApp(core);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions/missing',
      headers: { 'x-client-key': ckHeader },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().data).toBeNull();
  });

  it('gateway 网络层异常 → 502 upstream_error', async () => {
    const core = {
      createSession: mockImpl(async () => {
        throw new Error('ECONNREFUSED');
      }),
    } as unknown as CoreClient;
    const { app, ckHeader } = await buildApp(core);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { 'x-client-key': ckHeader, 'content-type': 'application/json' },
      payload: { id: 's1', agentId: 'a1' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ data: null, code: 502, message: 'upstream_error' });
  });
});
