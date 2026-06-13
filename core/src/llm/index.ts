// LLM 客户端入口：v6.1 重构为 createLLMClient(provider, llmConfig)。
// v1 是 createLLMClient(cfg)，已删除。
import { getFactory, type Factory, type Provider } from './factory.js';
import type { LLMClient } from './types.js';
import { LLMNotImplementedError } from './errors.js';

export function createLLMClient(provider: string, llmConfig: Record<string, unknown>): LLMClient {
  const factory = getFactory(provider as Provider);
  if (!factory) {
    throw new LLMNotImplementedError(provider);
  }
  return factory(llmConfig);
}

export { getFactory, type Factory, type Provider };
