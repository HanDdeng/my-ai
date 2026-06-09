// MockLLMClient 冒烟测试：确认回显逻辑与空消息兜底。
import { describe, it, expect } from 'vitest';
import { MockLLMClient } from '@/llm/mock.js';

describe('MockLLMClient', () => {
  it('回显最后一条 user 消息', async () => {
    const llm = new MockLLMClient();
    const res = await llm.chat({
      model: 'echo-mock',
      messages: [
        { role: 'system', content: '你是一个助手' },
        { role: 'user', content: '你好' },
      ],
    });
    expect(res.content).toBe('[mock:echo-mock] 你说: 你好');
  });

  it('没有 user 消息时回显为空', async () => {
    const llm = new MockLLMClient();
    const res = await llm.chat({
      model: 'echo-mock',
      messages: [{ role: 'system', content: 'sys' }],
    });
    expect(res.content).toBe('[mock:echo-mock] 你说: ');
  });
});
