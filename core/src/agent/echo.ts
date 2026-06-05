// Echo Agent：把用户消息交给 LLM 回显，是最小可用的 agent 实现，用于联调与冒烟。
import type { Agent, AgentDescriptor, AgentRunInput, AgentRunOutput } from './types.js';
import type { LLMClient } from '../llm/types.js';

export class EchoAgent implements Agent {
  // 依赖注入 LLM，便于在测试中替换为 mock 或 spy。
  constructor(private readonly llm: LLMClient) {}

  /**
   * 自身描述，路由用其注册到 AgentRegistry。
   */
  descriptor(): AgentDescriptor {
    return {
      id: 'echo',
      name: 'Echo Agent',
      description: '回显用户消息（mock LLM，用于联调与冒烟）',
      capabilities: ['chat'],
    };
  }

  /**
   * 同步运行：把用户消息丢给 LLM，包装成 AgentRunOutput 返回。
   */
  async run(input: AgentRunInput): Promise<AgentRunOutput> {
    const res = await this.llm.chat({
      model: 'echo-mock',
      messages: [input.message],
    });
    return {
      agentId: this.descriptor().id,
      sessionId: input.sessionId,
      reply: { role: 'assistant', content: res.content },
      finishedAt: new Date().toISOString(),
    };
  }
}
