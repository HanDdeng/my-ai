// OpenAI 兼容 chat completions 客户端。
// 走任意 OpenAI 兼容协议服务（Ollama / vLLM / LM Studio / 第三方代理 / OpenAI 公司）。
// baseUrl 必须含版本路径（如 /v1）；调用方拼接 /chat/completions。
// Node 20+ 内置 fetch，无新依赖。AbortSignal.timeout 可配；默认 600s 上限防挂死。
// v6.3.2: 改用 OpenAI 新 SDK 字段名：max_completion_tokens（替代 max_tokens）+ reasoning_effort。
// 老 max_tokens 仍兼容但 OpenAI SDK 0.x 已 deprecated，新 SDK 用 max_completion_tokens。
// 其他 OpenAI 兼容 provider（vLLM / LM Studio / 第三方代理）可能只支持 max_tokens；
//   暂优先 max_completion_tokens（OpenAI 官方字段名），后续可加 provider-specific 降级。
// 严格 OpenAI 协议：只发 model / messages / max_completion_tokens / reasoning_effort / stream，不掺 provider 私有字段。
import type { ChatRequest, ChatResponse, LLMClient } from './types.js';
import { LLMUpstreamError } from './errors.js';

export type OpenAICompatibleConfig = {
  baseUrl: string;
  apiKey?: string;
  model: string;
  // v6.3.2: 新名 max_completion_tokens 字段（但变量名沿用 maxTokens 保持内部一致）。
  maxTokens?: number | undefined;
  // v6.3.2: OpenAI o1 / o3 专用思考强度；'none' = 不思考；其他 provider 静默忽略该字段。
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | undefined;
  // v6.5: 请求超时（ms）；缺省 600_000。
  timeoutMs?: number | undefined;
};

export class OpenAICompatibleLLMClient implements LLMClient {
  constructor(private readonly cfg: OpenAICompatibleConfig) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.cfg.apiKey) {
      headers['Authorization'] = `Bearer ${this.cfg.apiKey}`;
    }
    // v6.3.2: 优先 req.maxTokens，其次 cfg.maxTokens，最后兜底 4096（OpenAI 新 SDK 默认）。
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      // OpenAI 新 SDK 字段名（替代旧 max_tokens）。GPT-4o / o1 / o3 / 兼容 SDK 全部接受。
      max_completion_tokens: req.maxTokens ?? this.cfg.maxTokens ?? 4096,
      stream: false,
    };
    // OpenAI reasoning_effort：o1 / o3 专用；其他模型 provider 静默忽略。'none' 表示不思考。
    if (this.cfg.reasoningEffort !== undefined) {
      body.reasoning_effort = this.cfg.reasoningEffort;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 600_000),
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
