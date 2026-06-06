// checkCompat 冒烟测试：覆盖在范围内、低于范围、高于上界、pre-release、非法输入、空串。
import { describe, it, expect } from 'vitest';
import { checkCompat } from './check.js';

describe('checkCompat', () => {
  it('version 在范围内 → true', () => {
    expect(checkCompat('2.0.0', '>=2.0.0 <3.0.0')).toBe(true);
  });

  it('version 低于范围 → false', () => {
    expect(checkCompat('1.5.0', '>=2.0.0 <3.0.0')).toBe(false);
  });

  it('version 高于范围上界（边界）→ false', () => {
    expect(checkCompat('3.0.0', '>=2.0.0 <3.0.0')).toBe(false);
  });

  it('version 在 pre-release 段但 base 在范围内 → true', () => {
    expect(checkCompat('2.0.0-rc.1', '>=2.0.0 <3.0.0')).toBe(true);
  });

  it('version 不是合法 semver → false（保守）', () => {
    expect(checkCompat('not-a-version', '>=2.0.0')).toBe(false);
  });

  it('range 不是合法 semver range → false（保守）', () => {
    expect(checkCompat('2.0.0', 'not-a-range')).toBe(false);
  });

  it('空字符串 → false', () => {
    expect(checkCompat('', '>=2.0.0')).toBe(false);
    expect(checkCompat('2.0.0', '')).toBe(false);
  });
});
