// /internal/clients 单元测试：列出 + 限 127.0.0.1 + online 标记。
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { openDatabase } from '@/db.js';
import { AuthStore } from '@/auth/store.js';
import { clientsRoutes } from '@/routes/internal/clients.js';

async function buildApp() {
  const store = new AuthStore(openDatabase(':memory:'));
  const app = Fastify({ logger: false });
  app.decorate('authStore', store);
  await app.register(clientsRoutes);
  return { app, store };
}

describe('/internal/clients', () => {
  it('列出所有 client + online 标记（60s 内 = online）', async () => {
    const { app, store } = await buildApp();
    const now = Date.now();
    store.insertClient({
      id: 'recent',
      keyHash: 'recent',
      name: 'recent',
      createdAt: now,
      lastSeenAt: now - 10_000,
    });
    store.insertClient({
      id: 'old',
      keyHash: 'old',
      name: 'old',
      createdAt: now - 1_000_000,
      lastSeenAt: now - 120_000,
    });
    const res = await app.inject({ method: 'GET', url: '/internal/clients' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.code).toBe(0);
    expect(body.data).toHaveLength(2);
    const recent = body.data.find((c: { id: string }) => c.id === 'recent');
    const old = body.data.find((c: { id: string }) => c.id === 'old');
    expect(recent.online).toBe(true);
    expect(old.online).toBe(false);
  });

  it('空列表返回空数组', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/internal/clients' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [], code: 0, message: 'ok' });
  });

  it('非 127.0.0.1 → 403', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/internal/clients',
      remoteAddress: '10.0.0.1',
    });
    expect(res.statusCode).toBe(403);
  });
});
