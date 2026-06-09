// auth middleware 单元测试：fastify.inject 验证鉴权 + 401 行为 + lastSeenAt 异步更新。
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { openDatabase } from '@/db.js';
import { AuthStore } from '@/auth/store.js';
import { authMiddleware } from '@/auth/middleware.js';
import { sha256 } from '@/auth/hash.js';

describe('authMiddleware', () => {
  let store: AuthStore;

  beforeEach(() => {
    store = new AuthStore(openDatabase(':memory:'));
  });

  async function buildApp() {
    const app = Fastify({ logger: false });
    app.decorate('authStore', store);
    await app.register(authMiddleware);
    app.get('/protected', async req => {
      // middleware 通过后 req.clientCtx 存在
      return { ctx: req.clientCtx };
    });
    app.get('/health', async () => ({ ok: true }));
    return app;
  }

  it('白名单路径直接放行（不读 header）', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('缺 X-Client-Key → 401 missing_key', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ data: null, code: 401, message: 'missing_key' });
  });

  it('错的 X-Client-Key → 401 invalid_key', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { 'x-client-key': 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ data: null, code: 401, message: 'invalid_key' });
  });

  it('对的 X-Client-Key → 通过 + req.clientCtx 正确', async () => {
    const now = Date.now();
    // middleware 用 sha256('plain-key') 查找 client，所以 id 必须是这个 hash
    const id = sha256('plain-key');
    store.insertClient({ id, keyHash: id, name: 'alice', createdAt: now, lastSeenAt: now });
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { 'x-client-key': 'plain-key' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ctx: { id, name: 'alice' } });
  });

  it('鉴权通过 → setImmediate 后 last_seen_at 更新', async () => {
    const now = Date.now();
    const id = sha256('plain-key');
    store.insertClient({ id, keyHash: id, name: null, createdAt: now, lastSeenAt: now });
    const app = await buildApp();

    // fastify.inject 是同步的，setImmediate 在 inject 返回后跑
    await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { 'x-client-key': 'plain-key' },
    });

    // 等一帧让 setImmediate 触发；setTimeout(2ms) 确保 Date.now() 比 now 至少大 1ms
    await new Promise(resolve => setTimeout(resolve, 2));
    const found = store.findByHash(id);
    expect(found?.last_seen_at).toBeGreaterThan(now);
  });
});
