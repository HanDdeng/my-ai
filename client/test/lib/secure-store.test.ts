// secure-store 单元测试：覆盖 Tauri (Stronghold) 与浏览器 (localStorage) 两条路径。
// 注：Task 5.6 之前不接 Rust 侧，所以 mock 充当"桩"：把整模块替换为内存实现。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadSecureConfig, saveSecureConfig, clearSecureConfig } from '@/lib/secure-store.js';

// vi.mock 会被 hoisted 到文件顶部；工厂内用到的变量必须用 vi.hoisted 提早创建。
const { mockStore, MockStronghold } = vi.hoisted(() => {
  const store: Record<string, Uint8Array> = {};
  class Stronghold {
    static load = async (_path: string, _password: string) => new Stronghold();
    // v6.5: 模拟 Stronghold.save() 让 saveToTauri/clearFromTauri 的落盘调用不报错。
    save = async () => undefined;
    async createClient(_name: string) {
      return {
        getStore: () => ({
          insert: async (k: string, v: number[]) => {
            store[k] = new Uint8Array(v);
          },
          get: async (k: string) => store[k] ?? null,
          remove: async (k: string) => {
            const v = store[k] ?? null;
            delete store[k];
            return v;
          },
        }),
      };
    }
  }
  return { mockStore: store, MockStronghold: Stronghold };
});

vi.mock('@tauri-apps/plugin-stronghold', () => ({
  Stronghold: MockStronghold,
}));

// 默认走 Tauri 路径（mock Stronghold），浏览器路径的 describe 单独切。
let mockIsTauri = true;
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => mockIsTauri,
}));

describe('secure-store (Tauri / Stronghold)', () => {
  beforeEach(() => {
    mockIsTauri = true;
    Object.keys(mockStore).forEach(k => delete mockStore[k]);
  });

  it('save 后 load 一致', async () => {
    await saveSecureConfig({
      clientKey: 'k1',
      gatewayUrl: 'http://x',
      pairKey: null,
      clientName: 'alice',
    });
    const got = await loadSecureConfig();
    expect(got).toEqual({
      clientKey: 'k1',
      gatewayUrl: 'http://x',
      pairKey: null,
      clientName: 'alice',
    });
  });

  it('未存过 load 返回 null', async () => {
    expect(await loadSecureConfig()).toBeNull();
  });

  it('clear 后 load 返回 null', async () => {
    await saveSecureConfig({
      clientKey: 'k1',
      gatewayUrl: 'http://x',
      pairKey: null,
      clientName: null,
    });
    await clearSecureConfig();
    expect(await loadSecureConfig()).toBeNull();
  });
});

// ===== v6.5: 持久化断言 =====
describe('secure-store (Stronghold 落盘)', () => {
  beforeEach(() => {
    mockIsTauri = true;
    Object.keys(mockStore).forEach(k => delete mockStore[k]);
  });

  it('saveSecureConfig calls stronghold.save() to persist to disk', async () => {
    const saveSpy = vi.fn().mockResolvedValue(undefined);
    // 重新 mock Stronghold，让 save() 可被监控
    vi.doMock('@tauri-apps/plugin-stronghold', () => ({
      Stronghold: class {
        static load = async () => new this();
        save = saveSpy;
        async loadClient() {
          throw new Error('not exists');
        }
        async createClient() {
          return {
            getStore: () => ({
              insert: async () => {},
              get: async () => null,
              remove: async () => null,
            }),
          };
        }
      },
    }));
    vi.resetModules();
    const mod = await import('@/lib/secure-store.js');
    await mod.saveSecureConfig({
      clientKey: 'ck',
      gatewayUrl: 'http://x',
      pairKey: null,
      clientName: null,
    });
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('clearSecureConfig calls stronghold.save() after remove', async () => {
    const saveSpy = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@tauri-apps/plugin-stronghold', () => ({
      Stronghold: class {
        static load = async () => new this();
        save = saveSpy;
        async loadClient() {
          return {
            getStore: () => ({
              insert: async () => {},
              get: async () => null,
              remove: async () => null,
            }),
          };
        }
      },
    }));
    vi.resetModules();
    const mod = await import('@/lib/secure-store.js');
    await mod.clearSecureConfig();
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });
});

describe('secure-store (浏览器 / localStorage fallback)', () => {
  beforeEach(() => {
    mockIsTauri = false;
    localStorage.clear();
  });

  it('save 后 load 一致', async () => {
    await saveSecureConfig({
      clientKey: 'k2',
      gatewayUrl: 'http://y',
      pairKey: 'pk',
      clientName: 'bob',
    });
    expect(await loadSecureConfig()).toEqual({
      clientKey: 'k2',
      gatewayUrl: 'http://y',
      pairKey: 'pk',
      clientName: 'bob',
    });
  });

  it('未存过 load 返回 null', async () => {
    expect(await loadSecureConfig()).toBeNull();
  });

  it('clear 后 load 返回 null', async () => {
    await saveSecureConfig({
      clientKey: 'k2',
      gatewayUrl: 'http://y',
      pairKey: null,
      clientName: null,
    });
    await clearSecureConfig();
    expect(await loadSecureConfig()).toBeNull();
  });
});
