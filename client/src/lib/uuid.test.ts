// uuid.ts 单元测试：覆盖三条分支（crypto.randomUUID / getRandomValues / Math.random）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomUUID } from './uuid.js';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomUUID', () => {
  const originalCrypto = globalThis.crypto;
  afterEach(() => {
    vi.stubGlobal('crypto', originalCrypto);
  });

  it('crypto.randomUUID 可用时直接走 native 路径', () => {
    const stub = '11111111-2222-4333-8444-555555555555';
    vi.stubGlobal('crypto', {
      ...originalCrypto,
      randomUUID: () => stub,
    });
    expect(randomUUID()).toBe(stub);
  });

  it('randomUUID 缺失时回退到 getRandomValues 且符合 v4 格式', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: <T extends ArrayBufferView>(buf: T): T => {
        const view = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        for (let i = 0; i < view.length; i++) {
          view[i] = i & 0xff;
        }
        return buf;
      },
    });
    const id = randomUUID();
    expect(id).toMatch(UUID_V4_REGEX);
  });

  it('无 crypto 时回退到 Math.random 路径', () => {
    // 模拟最旧环境：crypto 完全不存在
    vi.stubGlobal('crypto', undefined);
    const id = randomUUID();
    expect(id).toMatch(UUID_V4_REGEX);
  });

  it('两次调用产生不同 id（Math.random 路径不抖动）', () => {
    vi.stubGlobal('crypto', undefined);
    expect(randomUUID()).not.toBe(randomUUID());
  });
});
