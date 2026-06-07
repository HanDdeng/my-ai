// 网关 /health 单元测试：覆盖新响应包装 + version 字段。
// /health handler 现场读 .compat.generated.json，所以测试需要把文件临时
// 写成 9.9.9 让断言稳定（不依赖全局文件状态），测完恢复。
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { healthRoutes } from './health.js';
import type { Compat } from '../compat/load.js';

const fakeCompat: Compat = { version: '9.9.9', upstream: {} };

describe('gateway /health', () => {
  it('返回 ok 与服务名 + version', async () => {
    const slicePath = fileURLToPath(new URL('../../.compat.generated.json', import.meta.url));
    const originalContent = existsSync(slicePath) ? readFileSync(slicePath, 'utf8') : null;

    try {
      writeFileSync(
        slicePath,
        JSON.stringify({ version: '9.9.9', upstream: { core: '>=0.0.2 <0.1.0' } }),
      );

      const app = Fastify({ logger: false });
      app.decorate('compat', fakeCompat);
      await app.register(healthRoutes);
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        data: { ok: true, service: 'gateway', version: '9.9.9', schema: 1 },
        code: 0,
        message: 'ok',
      });
    } finally {
      if (originalContent !== null) {
        writeFileSync(slicePath, originalContent);
      } else {
        rmSync(slicePath);
      }
    }
  });
});
