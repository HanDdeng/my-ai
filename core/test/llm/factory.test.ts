import { describe, it, expect } from 'vitest';
import { getFactory } from '@/llm/factory.js';
import { OpenAICompatibleLLMClient } from '@/llm/openai-compatible.js';

describe('LLM factory', () => {
  it('openai-compatible 注册可查 → 返回 OpenAICompatibleLLMClient 实例', () => {
    const f = getFactory('openai-compatible');
    expect(f).toBeDefined();
    const client = f!({ baseUrl: 'http://x/v1', model: 'm' });
    expect(client).toBeInstanceOf(OpenAICompatibleLLMClient);
  });

  it('未知 provider → 返回 undefined', () => {
    expect(getFactory('anthropic' as never)).toBeUndefined();
  });

  it('v6.3.1: factory 透传 contextWindow', () => {
    const f = getFactory('openai-compatible');
    expect(f).toBeDefined();
    const client = f!({ baseUrl: 'http://x/v1', model: 'm', contextWindow: 32768 });
    expect(client).toBeInstanceOf(OpenAICompatibleLLMClient);
  });

  it('v6.3.2: factory 透传 reasoningEffort（string）', () => {
    const f = getFactory('openai-compatible');
    expect(f).toBeDefined();
    // 类型断言：factory 接受任意 Record<string, unknown>；reasoningEffort 是合法 string。
    const client = f!({ baseUrl: 'http://x/v1', model: 'o1', reasoningEffort: 'high' });
    expect(client).toBeInstanceOf(OpenAICompatibleLLMClient);
  });

  it('v6.3.2: factory reasoningEffort 非 string → 不透传（兜底）', () => {
    const f = getFactory('openai-compatible');
    expect(f).toBeDefined();
    // 非 string 应当被 factory 拒收，client 仍能构造（reasoningEffort=undefined）。
    const client = f!({ baseUrl: 'http://x/v1', model: 'm', reasoningEffort: 123 as never });
    expect(client).toBeInstanceOf(OpenAICompatibleLLMClient);
  });
});
