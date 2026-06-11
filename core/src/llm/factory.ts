// LLM provider factory：v6.1 拆 Map<provider, factory> 可插拔。
// MockLLMClient 不在 factories 注册（CI 通过依赖注入直接构造）。
// v6.3.2: passthrough reasoningEffort（已在 cfg 里）。
import type { LLMClient } from './types.js';
import { OpenAICompatibleLLMClient, type OpenAICompatibleConfig } from './openai-compatible.js';

export type Provider = 'openai-compatible';

export type Factory = (llmConfig: Record<string, unknown>) => LLMClient;

const factories = new Map<Provider, Factory>([
  [
    'openai-compatible',
    cfg => {
      const c: OpenAICompatibleConfig = {
        baseUrl: String(cfg.baseUrl),
        model: String(cfg.model),
      };
      if (typeof cfg.apiKey === 'string') {
        c.apiKey = cfg.apiKey;
      }
      if (typeof cfg.maxTokens === 'number') {
        c.maxTokens = cfg.maxTokens;
      }
      // v6.3.2: reasoningEffort 透传（Ollama / 其他 provider 静默忽略该字段）。
      if (typeof cfg.reasoningEffort === 'string') {
        c.reasoningEffort = cfg.reasoningEffort as OpenAICompatibleConfig['reasoningEffort'];
      }
      return new OpenAICompatibleLLMClient(c);
    },
  ],
]);

export function getFactory(provider: Provider): Factory | undefined {
  return factories.get(provider);
}
