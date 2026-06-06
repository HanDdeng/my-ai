import { describe, it, expect } from 'vitest';
import { checkMatrix } from './check-compat-matrix.mjs';

const baseMatrix = {
  schema: 1,
  components: {
    client: { version: '2.0.0' },
    gateway: { version: '2.0.0' },
    core: { version: '2.0.0' },
  },
  compat: {
    client: { gateway: '>=2.0.0 <3.0.0' },
    gateway: { core: '>=2.0.0 <3.0.0' },
    core: {},
  },
};

describe('checkMatrix', () => {
  it('合法 matrix 返回 null（无错误）', () => {
    expect(checkMatrix(baseMatrix)).toBeNull();
  });

  it('缺 schema 字段 → 返回错误信息', () => {
    const m = structuredClone(baseMatrix);
    delete m.schema;
    expect(checkMatrix(m)).toMatch(/schema/);
  });

  it('schema 不是 1 → 返回错误信息', () => {
    const m = structuredClone(baseMatrix);
    m.schema = 2;
    expect(checkMatrix(m)).toMatch(/schema/);
  });

  it('缺 components → 返回错误信息', () => {
    const m = structuredClone(baseMatrix);
    delete m.components;
    expect(checkMatrix(m)).toMatch(/components/);
  });

  it('components 缺 client/gateway/core → 返回错误信息', () => {
    const m = structuredClone(baseMatrix);
    m.components = { foo: { version: '1.0.0' } };
    expect(checkMatrix(m)).toMatch(/client/);
  });

  it('compat 引用不存在的组件 → 返回错误信息', () => {
    const m = structuredClone(baseMatrix);
    m.compat.gateway.core = '>=1.0.0';
    m.components = { client: { version: '1.0.0' } };
    expect(checkMatrix(m)).toMatch(/core/);
  });

  it('compat range 不是合法 semver range → 返回错误信息', () => {
    const m = structuredClone(baseMatrix);
    m.compat.client.gateway = 'not-a-range';
    expect(checkMatrix(m)).toMatch(/semver/);
  });
});
