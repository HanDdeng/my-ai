// LLM 错误类契约测试：NotImplemented 携带 provider 用于 501 转换；Upstream 透传 message 用于 502 转换。
import { describe, it, expect } from 'vitest';
import { LLMNotImplementedError, LLMUpstreamError } from '@/llm/errors.js';

describe('LLM errors', () => {
  it('LLMNotImplementedError 携带 provider', () => {
    const e = new LLMNotImplementedError('anthropic');
    expect(e.provider).toBe('anthropic');
    expect(e.name).toBe('LLMNotImplementedError');
    expect(e.message).toContain('anthropic');
    expect(e).toBeInstanceOf(Error);
  });

  it('LLMUpstreamError 携带 message', () => {
    const e = new LLMUpstreamError('HTTP 500');
    expect(e.message).toBe('HTTP 500');
    expect(e.name).toBe('LLMUpstreamError');
    expect(e).toBeInstanceOf(Error);
  });
});
