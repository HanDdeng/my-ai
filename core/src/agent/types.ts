import type { ChatMessage } from '../llm/types.js';

export type AgentId = string;

export type AgentDescriptor = {
  id: AgentId;
  name: string;
  description: string;
  capabilities: string[];
};

export type AgentRunInput = {
  agentId: AgentId;
  sessionId: string;
  message: ChatMessage;
};

export type AgentRunOutput = {
  agentId: AgentId;
  sessionId: string;
  reply: ChatMessage;
  finishedAt: string;
};

export interface Agent {
  descriptor(): AgentDescriptor;
  run(input: AgentRunInput): Promise<AgentRunOutput>;
}
