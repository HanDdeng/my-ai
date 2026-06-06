// core /health 路由冒烟：构造 server 后用 fastify.inject 拉一次，验证返回 ok。
import { describe, it, expect } from 'vitest';
import { buildServer } from '../server.js';
import type { Config } from '../config.js';
import type { Compat } from '../compat/load.js';

const cfg: Config = {
  PORT: 0,
  HOST: '127.0.0.1',
  LOG_LEVEL: 'fatal',
  CORS_ORIGINS: '',
  LLM_PROVIDER: 'mock',
  LLM_MODEL: 'echo-mock',
};

// 测试用 compat stub：buildServer 现在强制要求 compat 参数。
const compat: Compat = {
  version: '0.0.0-test',
  upstream: {},
};

describe('core /health', () => {
  it('返回 ok 与服务名', async () => {
    const app = await buildServer(cfg, compat);
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { ok: boolean; service: string };
      expect(body.ok).toBe(true);
      expect(body.service).toBe('core');
    } finally {
      await app.close();
    }
  });
});
