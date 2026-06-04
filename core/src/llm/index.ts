import type { LLMClient } from './types.js';
import { MockLLMClient } from './mock.js';
import type { Config } from '../config.js';

export function createLLMClient(cfg: Config): LLMClient {
  switch (cfg.LLM_PROVIDER) {
    case 'mock':
      return new MockLLMClient();
    case 'openai-compatible':
      throw new Error('openai-compatible provider not implemented yet');
  }
}
