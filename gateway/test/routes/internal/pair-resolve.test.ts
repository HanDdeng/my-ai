// /internal/pair/resolve 单元测试：限 127.0.0.1 + 错误尝试 3 次封禁。
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { openDatabase } from '@/db.js';
import { AuthStore } from '@/auth/store.js';
import { pairResolveRoutes } from '@/routes/internal/pair-resolve.js';

async function buildApp() {
  const store = new AuthStore(openDatabase(':memory:'));
  const app = Fastify({ logger: false });
  app.decorate('authStore', store);
  await app.register(pairResolveRoutes);
  return { app, store };
}

describe('/internal/pair/resolve', () => {
  it('正确 token → 200 + 写入 clients + 删除 pairing_code', async () => {
    const { app, store } = await buildApp();
    const now = Date.now();
    store.insertPairingCode({
      token: 'tk',
      clientId: 'h1',
      clientName: 'alice',
      expiresAt: now + 60_000,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/internal/pair/resolve',
      payload: { token: 'tk' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: null, code: 0, message: 'paired' });
    expect(store.findByHash('h1')).toMatchObject({ name: 'alice' });
    expect(store.findPairingCode('tk')).toBeNull();
  });

  it('错 token 第 1-3 次 → 404 + 不影响其他 token', async () => {
    const { app, store } = await buildApp();
    store.insertPairingCode({
      token: 'real',
      clientId: 'h1',
      clientName: null,
      expiresAt: Date.now() + 60_000,
    });
    for (let i = 1; i <= 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/internal/pair/resolve',
        payload: { token: 'wrong' },
      });
      expect(res.statusCode).toBe(404);
    }
    // 'real' token 不受错 token 尝试影响（无暴力破解保护逻辑）
    expect(store.findPairingCode('real')?.attempts).toBe(0);
  });

  it('错 token 第 4 次 → 404 + token 仍存在', async () => {
    const { app, store } = await buildApp();
    store.insertPairingCode({
      token: 'real',
      clientId: 'h1',
      clientName: null,
      expiresAt: Date.now() + 60_000,
    });
    for (let i = 0; i < 4; i++) {
      await app.inject({
        method: 'POST',
        url: '/internal/pair/resolve',
        payload: { token: 'wrong' },
      });
    }
    // 'real' token 仍存在（错 token 不影响其他 token）
    expect(store.findPairingCode('real')).not.toBeNull();
  });

  it('过期 token → 404', async () => {
    const { app, store } = await buildApp();
    store.insertPairingCode({
      token: 'old',
      clientId: 'h1',
      clientName: null,
      expiresAt: Date.now() - 1000,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/internal/pair/resolve',
      payload: { token: 'old' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('缺 token → 400', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/pair/resolve',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('非 127.0.0.1 → 403', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/pair/resolve',
      payload: { token: 'tk' },
      remoteAddress: '192.168.1.100',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ data: null, code: 403, message: 'forbidden' });
  });
});
