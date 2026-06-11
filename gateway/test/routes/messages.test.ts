// /v1/sessions/{id}/messages 路由层单测：2 端点（GET / POST）+ 错误码透传矩阵。
// 用 app.decorate('core', mockCore) 注入假 CoreClient；不真实发请求。
// v6.2 (Option B)：mockCore 返回 { status, body: <core 整包> }；2xx 解 .data 包 ok()，
// 4xx/5xx 真透传 core body。
import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDatabase } from '@/db.js';
import { AuthStore } from '@/auth/store.js';
import { sha256 } from '@/auth/hash.js';
import { authMiddleware } from '@/auth/middleware.js';
import { messagesRoutes } from '@/routes/messages.js';
import type { CoreClient } from '@/clients/core.js';

type CoreResponse = { status: number; body: unknown };

// 包装函数：vitest 2.x 的 vi 不能直接 vi(fn) 调用；必须 vi.fn().mockImplementation(fn)。
function mockImpl<T extends (...args: never[]) => unknown>(fn: T) {
  return vi.fn().mockImplementation(fn);
}

function buildMockCore(responses: Record<string, CoreResponse> = {}): CoreClient {
  const ok = (data: unknown): CoreResponse => ({
    status: 200,
    body: { data, code: 0, message: 'ok' },
  });
  return {
    listAgents: mockImpl(async () => ok([])),
    createAgent: mockImpl(async () => ok(null)),
    getAgent: mockImpl(async () => ok(null)),
    updateAgent: mockImpl(async () => ok(null)),
    deleteAgent: mockImpl(async () => ok(null)),
    createSession: mockImpl(async () => ok(null)),
    getSession: mockImpl(async () => ok(null)),
    deleteSession: mockImpl(async () => ok(null)),
    listMessages: mockImpl(async (_ck: string, _sid: string) => responses.listMessages ?? ok([])),
    postMessage: mockImpl(
      async (_ck: string, _sid: string, _b: unknown) =>
        responses.postMessage ?? ok({ userMessage: { id: 'um' }, assistantMessage: { id: 'am' } }),
    ),
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
    await messagesRoutes(instance, core);
  });
  return { app, ckHeader: ck };
}

describe('/v1/sessions/{id}/messages routes', () => {
  it('GET /v1/sessions/{id}/messages：200 + 解 core.data 包 ok()（messages 列表）', async () => {
    const core = buildMockCore({
      listMessages: {
        status: 200,
        body: { data: [{ id: 'm1', role: 'user' }], code: 0, message: 'ok' },
      },
    });
    const { app, ckHeader } = await buildApp(core);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions/s1/messages',
      headers: { 'x-client-key': ckHeader },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [{ id: 'm1', role: 'user' }], code: 0, message: 'ok' });
  });

  it('POST /v1/sessions/{id}/messages：200 + 解 core.data 包 ok()（userMessage + assistantMessage）', async () => {
    const core = buildMockCore({
      postMessage: {
        status: 200,
        body: {
          data: { userMessage: { id: 'um' }, assistantMessage: { id: 'am', content: 'hi' } },
          code: 0,
          message: 'ok',
        },
      },
    });
    const { app, ckHeader } = await buildApp(core);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/s1/messages',
      headers: { 'x-client-key': ckHeader, 'content-type': 'application/json' },
      payload: { id: 'um', content: 'hello' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: { userMessage: { id: 'um' }, assistantMessage: { id: 'am', content: 'hi' } },
      code: 0,
      message: 'ok',
    });
  });

  it('错误码透传：core 404 session_not_found 整包透传', async () => {
    const core = buildMockCore({
      listMessages: {
        status: 404,
        body: { data: null, code: 404, message: 'session_not_found' },
      },
    });
    const { app, ckHeader } = await buildApp(core);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions/missing/messages',
      headers: { 'x-client-key': ckHeader },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ data: null, code: 404, message: 'session_not_found' });
  });

  it('gateway 网络层异常 → 502 upstream_error', async () => {
    const core = {
      postMessage: mockImpl(async () => {
        throw new Error('ECONNREFUSED');
      }),
    } as unknown as CoreClient;
    const { app, ckHeader } = await buildApp(core);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/s1/messages',
      headers: { 'x-client-key': ckHeader, 'content-type': 'application/json' },
      payload: { id: 'um', content: 'hello' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ data: null, code: 502, message: 'upstream_error' });
  });
});
