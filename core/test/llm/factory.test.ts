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
});
