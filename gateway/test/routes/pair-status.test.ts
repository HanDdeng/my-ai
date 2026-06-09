// /pair/status 单元测试：覆盖 PENDING / PAIRED / EXPIRED / 不存在。
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { openDatabase } from '@/db.js';
import { AuthStore } from '@/auth/store.js';
import { authMiddleware } from '@/auth/middleware.js';
import { pairStatusRoutes } from '@/routes/pair-status.js';

async function buildApp() {
  const store = new AuthStore(openDatabase(':memory:'));
  const app = Fastify({ logger: false });
  app.decorate('authStore', store);
  await app.register(authMiddleware);
  await app.register(pairStatusRoutes);
  return { app, store };
}

describe('/pair/status', () => {
  it('token 存在 + 未过期 + 未配对 → PENDING', async () => {
    const { app, store } = await buildApp();
    const now = Date.now();
    store.insertPairingCode({
      token: 'tk',
      clientId: 'h1',
      clientName: null,
      expiresAt: now + 60_000,
    });
    const res = await app.inject({ method: 'GET', url: '/pair/status?token=tk' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { status: 'PENDING' }, code: 0, message: 'ok' });
  });

  it('token 存在 + 已配对 → PAIRED', async () => {
    const { app, store } = await buildApp();
    const now = Date.now();
    const hash = 'h1';
    store.insertClient({ id: hash, keyHash: hash, name: null, createdAt: now, lastSeenAt: now });
    store.insertPairingCode({
      token: 'tk',
      clientId: hash,
      clientName: null,
      expiresAt: now + 60_000,
    });
    const res = await app.inject({ method: 'GET', url: '/pair/status?token=tk' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { status: 'PAIRED' }, code: 0, message: 'ok' });
  });

  it('token 存在 + 已过期 → EXPIRED', async () => {
    const { app, store } = await buildApp();
    const now = Date.now();
    store.insertPairingCode({
      token: 'tk',
      clientId: 'h1',
      clientName: null,
      expiresAt: now - 1000,
    });
    const res = await app.inject({ method: 'GET', url: '/pair/status?token=tk' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { status: 'EXPIRED' }, code: 0, message: 'ok' });
  });

  it('token 不存在 → 404', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/pair/status?token=nonexistent' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ data: null, code: 404, message: 'token_not_found' });
  });

  it('缺 token 参数 → 400', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/pair/status' });
    expect(res.statusCode).toBe(400);
  });
});
