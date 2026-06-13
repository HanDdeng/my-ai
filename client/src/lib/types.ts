// 共享 TS 类型：Agent / Session / Message + 4 Request/Response Body。
// 字段集与 v6.1 core 端 §5.3.2 契约对齐；client 端不重新定义，仅 import 用。
// 注: maxCompletionTokens 是 number | null（v6.1 端 ≥1 或 NULL）；capabilities 是 string[]（v6.1 灵活 JSON）。
// 注: v6.3 form 隐藏 capabilities 字段（决策 4）；类型仍导出供后续编辑 UI 复用。
// v6.3.1: 新增 contextWindow（云端模型需要区分 per-response maxTokens 与总 context window）。
// v6.3.2: 改用 OpenAI 新 SDK 字段名 maxCompletionTokens（client 端字段名也跟 core 协议对齐）；
//   新增 reasoningEffort（OpenAI o1/o3 思考强度；其他 provider 静默忽略）。
// v6.4: 移除 Agent.reasoningEffort（不再持久化；改由 PostMessageBody.reasoningEffort 传参）；
//   新增 Agent.apiKey（per-agent 凭据；null = 回退到 env LLM_API_KEY）。
//   contextWindow 类型保持 number | null（schema 默认 4096 落到 DB；UI 空 = 4096）。
// v6.5: 解除 maxCompletionTokens ≤32000 上限（Issue #4）；由 upstream LLM 决定。
export type Agent = {
  id: string;
  name: string;
  description: string;
  llmProvider: 'openai-compatible';
  baseUrl: string;
  model: string;
  // v6.3.2: 改用 maxCompletionTokens（OpenAI 新 SDK 字段 max_completion_tokens 对齐）。
  // null = 用 core 默认 4096。v6.5 解除 ≤32000 上限（由 upstream LLM 决定）。
  maxCompletionTokens: number | null;
  contextWindow: number | null;
  // v6.4: per-agent 凭据；null = 回退到 env LLM_API_KEY。
  apiKey: string | null;
  enabledApi: boolean;
  systemPrompt: string;
  capabilities: string[];
  createdAt: string;
  updatedAt: string;
};

export type Session = {
  id: string;
  agentId: string;
  clientKey: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
};

// Request / Response Body（client 端 POST/PATCH 时构造的 body 形态）
export type CreateAgentBody = Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateAgentBody = Partial<
  Omit<Agent, 'id' | 'llmProvider' | 'createdAt' | 'updatedAt'>
>;
export type CreateSessionBody = { id: string; agentId: string };
// v6.4: reasoningEffort 由消息接口传；client 暂时硬编码 'none'，未来做 UI 时从表单拿。
export type PostMessageBody = {
  id: string;
  content: string;
  reasoningEffort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
};
export type PostMessageResponse = { userMessage: Message; assistantMessage: Message };
