// LLM 抽象层：定义 chat 接口与消息/请求/响应类型。
// 真正的 provider（OpenAI、Anthropic、本地 vLLM 等）实现 LLMClient 即可被 Agent 调用。

/** 三类标准 chat 消息角色。 */
export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

/** 单次 chat 请求。 */
export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
};

/** 单次 chat 响应。usage 可选，部分 provider 不返回。 */
export type ChatResponse = {
  content: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
};

/**
 * LLM 客户端接口：屏蔽具体 provider 差异。
 * 实现类负责序列化、鉴权、流式 / 同步策略。
 */
export interface LLMClient {
  chat(req: ChatRequest): Promise<ChatResponse>;
}
