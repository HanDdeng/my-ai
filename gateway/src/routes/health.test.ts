// 网关 /health 路由冒烟：构造 server 后用 fastify.inject 拉一次，验证返回 ok。
import { describe, it, expect } from 'vitest';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';

describe('gateway /health', () => {
  it('返回 ok 与服务名', async () => {
    const app = await buildServer(loadConfig(), {
      version: '0.0.0-test',
      upstream: { core: '>=0.0.0' },
    });
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { ok: boolean; service: string };
      expect(body.ok).toBe(true);
      expect(body.service).toBe('gateway');
    } finally {
      await app.close();
    }
  });
});

describe('/health version 字段', () => {
  it('响应含 version 和 schema', async () => {
    const app = await buildServer(loadConfig(), {
      version: '2.0.0',
      upstream: { core: '>=2.0.0 <3.0.0' },
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      service: 'gateway',
      version: '2.0.0',
      schema: 1,
    });
  });
});
