import type { Agent, AgentDescriptor, AgentRunInput, AgentRunOutput } from './types.js';
import type { LLMClient } from '../llm/types.js';

export class EchoAgent implements Agent {
  constructor(private readonly llm: LLMClient) {}

  descriptor(): AgentDescriptor {
    return {
      id: 'echo',
      name: 'Echo Agent',
      description: '回显用户消息（mock LLM，用于联调与冒烟）',
      capabilities: ['chat'],
    };
  }

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
