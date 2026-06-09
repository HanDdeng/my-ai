// /pair route 单元测试：fastify.inject 覆盖 4 种决策 + 幂等 + 缺 clientKey。
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { openDatabase } from '../db.js';
import { AuthStore } from '../auth/store.js';
import { sha256 } from '../auth/hash.js';
import { authMiddleware } from '../auth/middleware.js';
import { pairRoutes } from './pair.js';

async function buildApp(opts: { public: boolean; pairKey?: string }) {
  const store = new AuthStore(openDatabase(':memory:'));
  const app = Fastify({ logger: false });
  app.decorate('authStore', store);
  // exactOptionalPropertyTypes 下不显式赋值时不能塞 undefined 给可选字段，按需展开。
  const config: { GATEWAY_PAIRING_PUBLIC: boolean; GATEWAY_PAIR_KEY?: string } = {
    GATEWAY_PAIRING_PUBLIC: opts.public,
  };
  if (opts.pairKey !== undefined) {
    config.GATEWAY_PAIR_KEY = opts.pairKey;
  }
  app.decorate('config', config);
  await app.register(authMiddleware);
  await app.register(pairRoutes);
  return { app, store };
}

const sampleClientKey = 'client-key-1';
const sampleHash = sha256(sampleClientKey);

describe('/pair', () => {
  describe('公开模式', () => {
    it('无 pairKey → 200 + 写入 DB', async () => {
      const { app, store } = await buildApp({ public: true });
      const res = await app.inject({
        method: 'POST',
        url: '/pair',
        payload: { clientKey: sampleClientKey, name: 'alice' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        data: { clientKey: sampleClientKey, name: 'alice' },
        code: 0,
        message: 'ok',
      });
      expect(store.findByHash(sampleHash)).not.toBeNull();
    });

    it('错 pairKey → 200（公开模式忽略）', async () => {
      const { app, store } = await buildApp({ public: true, pairKey: 'admin' });
      const res = await app.inject({
        method: 'POST',
        url: '/pair',
        payload: { clientKey: sampleClientKey, pairKey: 'wrong', name: null },
      });
      expect(res.statusCode).toBe(200);
      expect(store.findByHash(sampleHash)).not.toBeNull();
    });

    it('对 pairKey → 200', async () => {
      const { app } = await buildApp({ public: true, pairKey: 'admin' });
      const res = await app.inject({
        method: 'POST',
        url: '/pair',
        payload: { clientKey: sampleClientKey, pairKey: 'admin' },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('私有模式', () => {
    it('对 pairKey → 200 + 写入 DB', async () => {
      const { app, store } = await buildApp({ public: false, pairKey: 'admin' });
      const res = await app.inject({
        method: 'POST',
        url: '/pair',
        payload: { clientKey: sampleClientKey, pairKey: 'admin' },
      });
      expect(res.statusCode).toBe(200);
      expect(store.findByHash(sampleHash)).not.toBeNull();
    });

    it('无 pairKey → 202 + 写入 pairing_code', async () => {
      const { app, store } = await buildApp({ public: false });
      const res = await app.inject({
        method: 'POST',
        url: '/pair',
        payload: { clientKey: sampleClientKey, name: 'alice' },
      });
      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.code).toBe(0);
      expect(body.message).toBe('pair_pending');
      expect(body.data.token).toBeTypeOf('string');
      expect(body.data.expiresAt).toBeTypeOf('number');
      expect(store.listClients()).toHaveLength(0);
    });

    it('错 pairKey → 202（防枚举，不区分）', async () => {
      const { app } = await buildApp({ public: false, pairKey: 'admin' });
      const res = await app.inject({
        method: 'POST',
        url: '/pair',
        payload: { clientKey: sampleClientKey, pairKey: 'wrong' },
      });
      expect(res.statusCode).toBe(202);
    });
  });

  describe('幂等性', () => {
    it('已存在的 clientKey 再次 POST /pair → 200 不重写', async () => {
      const { app, store } = await buildApp({ public: true });
      await app.inject({
        method: 'POST',
        url: '/pair',
        payload: { clientKey: sampleClientKey, name: 'alice' },
      });
      const before = store.findByHash(sampleHash);

      // 第二次，name 变了但 clientKey 同
      const res = await app.inject({
        method: 'POST',
        url: '/pair',
        payload: { clientKey: sampleClientKey, name: 'different-name' },
      });
      expect(res.statusCode).toBe(200);
      const after = store.findByHash(sampleHash);
      expect(after?.name).toBe('alice'); // 没改
      expect(after?.created_at).toBe(before?.created_at); // 没改
      expect(store.listClients()).toHaveLength(1);
    });
  });

  describe('错误', () => {
    it('缺 clientKey → 400', async () => {
      const { app } = await buildApp({ public: true });
      const res = await app.inject({
        method: 'POST',
        url: '/pair',
        payload: { name: 'alice' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('clientKey 非字符串 → 400', async () => {
      const { app } = await buildApp({ public: true });
      const res = await app.inject({
        method: 'POST',
        url: '/pair',
        payload: { clientKey: 123 },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
