// public-paths 单元测试：覆盖所有白名单路径 + 边界 case。
import { describe, it, expect } from 'vitest';
import { isPublicPath } from '@/auth/public-paths.js';

describe('isPublicPath', () => {
  it.each([
    '/health',
    '/health?foo=bar',
    '/pair',
    '/pair/status',
    '/pair/status?token=xxx',
    '/internal/pair/resolve',
    '/internal/clients',
  ])('白名单：%s', url => {
    expect(isPublicPath(url)).toBe(true);
  });

  it.each(['/v1/agents', '/', '/agents', '/healthcheck'])('非白名单：%s', url => {
    expect(isPublicPath(url)).toBe(false);
  });
});
