// i18n init 行为测试（v5）：覆盖 localStorage / navigator / fallback 三个降级层。
// 本文件用 `?v=` 动态 import + Date.now() 缓存绕过，每次重跑 detectLng()。
// Task 5 会在 client/test/setup.ts 顶部加 i18n.changeLanguage('zh-CN')，本文件暂不依赖。
import { describe, it, expect, beforeEach } from 'vitest';

describe('i18n init', () => {
  beforeEach(() => {
    // 每次测试前清空 localStorage 与 navigator.language
    try {
      localStorage.clear();
    } catch {
      // 隐私模式可能不可用
    }
  });

  it('localStorage 缺 + navigator=en-US → init 后 i18n.language 含 en', async () => {
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });
    const { default: i18n } = await import('./index.js?v=nolang&' + Date.now());
    expect(i18n.language).toBe('en');
  });

  it('localStorage 缺 + navigator=zh-CN → init 后 i18n.language=zh-CN', async () => {
    Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true });
    const { default: i18n } = await import('./index.js?v=nolangzh&' + Date.now());
    expect(i18n.language).toBe('zh-CN');
  });

  it('localStorage 缺 + navigator=ja-JP → 降级 zh-CN', async () => {
    Object.defineProperty(navigator, 'language', { value: 'ja-JP', configurable: true });
    const { default: i18n } = await import('./index.js?v=nolangja&' + Date.now());
    expect(i18n.language).toBe('zh-CN');
  });

  it('i18n.t 翻译 zh-CN 资源能拿到中文文案', async () => {
    const { default: i18n } = await import('./index.js?v=t1&' + Date.now());
    expect(i18n.t('settings.test', { lng: 'zh-CN' })).toBe('测试');
  });

  it('i18n.t 翻译 en 资源能拿到英文文案', async () => {
    const { default: i18n } = await import('./index.js?v=t2&' + Date.now());
    expect(i18n.t('settings.test', { lng: 'en' })).toBe('Test');
  });
});
