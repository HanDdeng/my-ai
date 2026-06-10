// v5: check-i18n 脚本单测。
// 用 vitest 跑；规则：
//  1. en + zh-CN 都是合法 JSON
//  2. key 集合完全一致
//  3. value 必须是 string
import { describe, it, expect } from 'vitest';
import { checkI18n } from './check-i18n.mjs';

describe('check-i18n', () => {
  it('两个 locale 都合法 + key 一致 + value 都是 string → pass', () => {
    const result = checkI18n({
      en: { greeting: 'Hello', farewell: 'Bye' },
      'zh-CN': { greeting: '你好', farewell: '再见' },
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('en 缺 key → fail', () => {
    const result = checkI18n({
      en: { greeting: 'Hello' },
      'zh-CN': { greeting: '你好', farewell: '再见' },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes('farewell'))).toBe(true);
  });

  it('value 不是 string → fail', () => {
    const result = checkI18n({
      en: { greeting: 'Hello', count: 5 },
      'zh-CN': { greeting: '你好', count: 5 },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes('count') && e.includes('string'))).toBe(true);
  });

  it('深层嵌套 key 不一致 → fail', () => {
    const result = checkI18n({
      en: { pair: { banner: { kicker: 'A' } } },
      'zh-CN': { pair: { banner: { kicker: 'B', extra: '多余' } } },
    });
    expect(result.ok).toBe(false);
  });

  it('空对象 → pass（key 集合都是空）', () => {
    const result = checkI18n({ en: {}, 'zh-CN': {} });
    expect(result.ok).toBe(true);
  });
});
