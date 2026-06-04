export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
};

export type ChatResponse = {
  content: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
};

export interface LLMClient {
  chat(req: ChatRequest): Promise<ChatResponse>;
}
