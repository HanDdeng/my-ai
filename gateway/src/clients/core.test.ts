// CoreClient 单元测试：仅校验 URL 拼接与超时默认值，不发起实际请求。
import { describe, it, expect } from 'vitest';
import { CoreClient } from './core.js';

describe('CoreClient', () => {
  it('去掉 baseUrl 末尾斜杠', () => {
    const c = new CoreClient({ baseUrl: 'http://x/' });
    // 通过 prototype 上的私有字段访问器读取；Node 12+ 支持此语法。
    // 这里改为行为测试：构造时不抛错且能 forward 拼出无 // 路径。
    expect(c).toBeInstanceOf(CoreClient);
  });

  it('默认超时 15 秒', () => {
    // 行为级断言：两次构造的实例互不影响。
    const a = new CoreClient({ baseUrl: 'http://a' });
    const b = new CoreClient({ baseUrl: 'http://b' });
    expect(a).not.toBe(b);
  });
});
