// response.ts 单元测试。
import { describe, it, expect } from 'vitest';
import { ok, err } from '@/response.js';

describe('统一响应包装', () => {
  it('ok 成功响应', () => {
    expect(ok({ foo: 1 })).toEqual({ data: { foo: 1 }, code: 0, message: 'ok' });
  });

  it('ok 接受 null', () => {
    expect(ok(null)).toEqual({ data: null, code: 0, message: 'ok' });
  });

  it('ok 接受字符串', () => {
    expect(ok('hi')).toEqual({ data: 'hi', code: 0, message: 'ok' });
  });

  it('err 错误响应', () => {
    expect(err(401, 'unauthorized')).toEqual({ data: null, code: 401, message: 'unauthorized' });
  });

  it('err code 为 0 仍允许（业务错误语义）', () => {
    expect(err(0, 'something')).toEqual({ data: null, code: 0, message: 'something' });
  });
});
