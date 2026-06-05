// LLM 客户端工厂：按 config 选 provider；新加 provider 只需在此 switch 中增加 case。
import type { LLMClient } from './types.js';
import { MockLLMClient } from './mock.js';
import type { Config } from '../config.js';

/**
 * 根据配置构造 LLM 客户端；当前只支持 mock。
 * openai-compatible 留待后续实现（v1.0 占位）。
 */
export function createLLMClient(cfg: Config): LLMClient {
  switch (cfg.LLM_PROVIDER) {
    case 'mock':
      return new MockLLMClient();
    case 'openai-compatible':
      throw new Error('openai-compatible provider not implemented yet');
  }
}
