// gateway/src/auth/hash.ts 的单元测试。
import { describe, it, expect } from 'vitest';
import { sha256 } from './hash.js';

describe('sha256', () => {
  it('已知输入 → 已知 hex 输出', () => {
    // 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(sha256('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('空字符串', () => {
    // e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('中文输入', () => {
    // 不关心具体值，只关心稳定 + 64 字符 hex
    const h = sha256('你好');
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    // 幂等
    expect(sha256('你好')).toBe(h);
  });
});
