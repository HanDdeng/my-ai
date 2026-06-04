import type { ChatRequest, ChatResponse, LLMClient } from './types.js';

export class MockLLMClient implements LLMClient {
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const last = req.messages.at(-1);
    const echo = last && last.role === 'user' ? last.content : '';
    return {
      content: `[mock:${req.model}] 你说: ${echo}`,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }
}
