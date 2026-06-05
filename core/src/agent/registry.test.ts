// AgentRegistry 冒烟测试：覆盖 register / get / list 三条主路径。
import { describe, it, expect } from 'vitest';
import { AgentRegistry } from './registry.js';
import { EchoAgent } from './echo.js';
import { MockLLMClient } from '../llm/mock.js';

describe('AgentRegistry', () => {
  it('注册后能按 id 取出', () => {
    const reg = new AgentRegistry();
    const llm = new MockLLMClient();
    reg.register(new EchoAgent(llm));

    const got = reg.get('echo');
    expect(got?.descriptor().id).toBe('echo');
  });

  it('未注册 id 返回 undefined', () => {
    const reg = new AgentRegistry();
    expect(reg.get('nope')).toBeUndefined();
  });

  it('list 返回所有 agent 的 descriptor', () => {
    const reg = new AgentRegistry();
    const llm = new MockLLMClient();
    reg.register(new EchoAgent(llm));

    const list = reg.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('echo');
    expect(list[0]?.capabilities).toContain('chat');
  });
});
