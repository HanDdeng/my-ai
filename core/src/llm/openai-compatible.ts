// OpenAI 兼容 chat completions 客户端。
// 走任意 OpenAI 兼容协议服务（Ollama / vLLM / LM Studio / 第三方代理 / OpenAI 公司）。
// baseUrl 必须含版本路径（如 /v1）；调用方拼接 /chat/completions。
// Node 20+ 内置 fetch，无新依赖。AbortSignal.timeout 60s 上限防挂死。
// v6.3.1: contextWindow → num_ctx（Ollama 字段；其他 OpenAI 兼容 provider 静默忽略）。
import type { ChatRequest, ChatResponse, LLMClient } from './types.js';
import { LLMUpstreamError } from './errors.js';

export type OpenAICompatibleConfig = {
  baseUrl: string;
  apiKey?: string;
  model: string;
  maxTokens?: number | undefined;
  contextWindow?: number | undefined;
};

export class OpenAICompatibleLLMClient implements LLMClient {
  constructor(private readonly cfg: OpenAICompatibleConfig) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.cfg.apiKey) {
      headers['Authorization'] = `Bearer ${this.cfg.apiKey}`;
    }
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      max_tokens: req.maxTokens ?? this.cfg.maxTokens,
      stream: false,
    };
    // v6.3.1: Ollama 专用字段；非 Ollama provider 收到会静默忽略。
    if (this.cfg.contextWindow !== undefined) {
      body.num_ctx = this.cfg.contextWindow;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      throw new LLMUpstreamError(`fetch failed: ${(e as Error).message}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new LLMUpstreamError(`HTTP ${res.status}: ${text.slice(0, 256)}`);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new LLMUpstreamError('response is not valid JSON');
    }

    const content = (json as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]
      ?.message?.content;
    if (typeof content !== 'string') {
      throw new LLMUpstreamError('response missing choices[0].message.content');
    }
    const usageRaw = (json as { usage?: unknown })?.usage;
    if (usageRaw && typeof usageRaw === 'object') {
      return {
        content,
        usage: {
          promptTokens: Number((usageRaw as Record<string, unknown>).prompt_tokens) || 0,
          completionTokens: Number((usageRaw as Record<string, unknown>).completion_tokens) || 0,
          totalTokens: Number((usageRaw as Record<string, unknown>).total_tokens) || 0,
        },
      };
    }
    return { content };
  }
}
