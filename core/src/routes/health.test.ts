// core /health 路由冒烟：构造 server 后用 fastify.inject 拉一次，验证返回 ok。
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildServer } from '../server.js';
import { loadConfig, type Config } from '../config.js';
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

describe('/health version 字段', () => {
  it('响应含 version 和 schema（version 来自 .compat.generated.json 现场读）', async () => {
    // /health 现在每次都现场从 .compat.generated.json 读 version，
    // 所以 stub 传的 version 0.0.2 只在文件被删/损坏时作 fallback；
    // 文件存在且合法时，响应 version 等于文件内容。
    // 临时把文件写成 0.0.1 让断言稳定（不依赖全局文件状态）。
    const slicePath = fileURLToPath(new URL('../../.compat.generated.json', import.meta.url));
    const originalContent = existsSync(slicePath) ? readFileSync(slicePath, 'utf8') : null;

    try {
      writeFileSync(slicePath, JSON.stringify({ version: '0.0.1', upstream: {} }));

      const app = await buildServer(loadConfig(), {
        version: '0.0.0-stub',
        upstream: {},
      });
      try {
        const res = await app.inject({ method: 'GET', url: '/health' });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body).toMatchObject({
          ok: true,
          service: 'core',
          version: '0.0.1',
          schema: 1,
        });
      } finally {
        await app.close();
      }
    } finally {
      if (originalContent !== null) {
        writeFileSync(slicePath, originalContent);
      } else {
        rmSync(slicePath);
      }
    }
  });
});

describe('GET /health 实时读 compat slice', () => {
  it('改 .compat.generated.json 后 /health 反映新值（不需重启）', async () => {
    // 测试目标：现场从 .compat.generated.json 读，stale app.compat 不能掩盖现场值。
    // 把 .compat.generated.json 临时写成 0.0.1，buildServer 传 stub 0.0.2，
    // /health 应当返回 0.0.1（现场值）而不是 0.0.2（缓存值）。
    const slicePath = fileURLToPath(new URL('../../.compat.generated.json', import.meta.url));
    const originalContent = existsSync(slicePath) ? readFileSync(slicePath, 'utf8') : null;

    try {
      writeFileSync(slicePath, JSON.stringify({ version: '0.0.1', upstream: {} }));

      const app = await buildServer(loadConfig(), {
        version: '0.0.2',
        upstream: {},
      });
      try {
        const res = await app.inject({ method: 'GET', url: '/health' });
        expect(res.statusCode).toBe(200);
        const body = res.json() as { version: string };
        expect(body.version).toBe('0.0.1');
      } finally {
        await app.close();
      }
    } finally {
      // 恢复原内容，避免污染其他测试。
      if (originalContent !== null) {
        writeFileSync(slicePath, originalContent);
      } else {
        rmSync(slicePath);
      }
    }
  });
});
