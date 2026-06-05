// Mock LLM：仅做 echo 回显，用于开发期联调与冒烟测试。
// 不依赖任何外部服务，可作为 CI 跑通的最小 LLM 实现。
import type { ChatRequest, ChatResponse, LLMClient } from './types.js';

export class MockLLMClient implements LLMClient {
  async chat(req: ChatRequest): Promise<ChatResponse> {
    // 找最后一条 user 消息作为回显内容；其它角色（system/assistant）暂不处理。
    const last = req.messages.at(-1);
    const echo = last && last.role === 'user' ? last.content : '';
    return {
      content: `[mock:${req.model}] 你说: ${echo}`,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }
}
