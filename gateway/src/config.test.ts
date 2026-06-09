// gateway/src/config.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig v3 新字段', () => {
  // 阻止 process.exit(1) 在 TTL 负数测试里把测试进程干掉。
  // 真实启动期 fail-fast 行为在生产代码里保持不变。
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called');
  }) as never);
  afterEach(() => {
    exitSpy.mockClear();
  });

  const baseEnv = {
    PORT: '8787',
    HOST: '127.0.0.1',
    CORE_URL: 'http://127.0.0.1:8788',
    LOG_LEVEL: 'info',
    CORS_ORIGINS: 'http://localhost:5173',
  };

  it('GATEWAY_PAIRING_PUBLIC 默认 false', () => {
    const cfg = loadConfig({ ...baseEnv, NODE_ENV: 'test' } as never);
    expect(cfg.GATEWAY_PAIRING_PUBLIC).toBe(false);
  });

  it('GATEWAY_PAIRING_PUBLIC=true 被接受', () => {
    const cfg = loadConfig({ ...baseEnv, GATEWAY_PAIRING_PUBLIC: 'true' } as never);
    expect(cfg.GATEWAY_PAIRING_PUBLIC).toBe(true);
  });

  it('GATEWAY_PAIR_KEY 可选', () => {
    const cfg = loadConfig(baseEnv as never);
    expect(cfg.GATEWAY_PAIR_KEY).toBeUndefined();
    const cfg2 = loadConfig({ ...baseEnv, GATEWAY_PAIR_KEY: 'admin-key' } as never);
    expect(cfg2.GATEWAY_PAIR_KEY).toBe('admin-key');
  });

  it('GATEWAY_PAIRING_KEY_TTL 接受 0 和正整数', () => {
    const cfg0 = loadConfig({ ...baseEnv, GATEWAY_PAIRING_KEY_TTL: '0' } as never);
    expect(cfg0.GATEWAY_PAIRING_KEY_TTL).toBe(0);
    const cfg1 = loadConfig({ ...baseEnv, GATEWAY_PAIRING_KEY_TTL: '3600' } as never);
    expect(cfg1.GATEWAY_PAIRING_KEY_TTL).toBe(3600);
  });

  it('GATEWAY_PAIRING_KEY_TTL 负数抛错', () => {
    expect(() => loadConfig({ ...baseEnv, GATEWAY_PAIRING_KEY_TTL: '-1' } as never)).toThrow();
  });

  it('GATEWAY_DB_PATH 默认 ./gateway.db', () => {
    const cfg = loadConfig(baseEnv as never);
    expect(cfg.GATEWAY_DB_PATH).toBe('./gateway.db');
  });
});
