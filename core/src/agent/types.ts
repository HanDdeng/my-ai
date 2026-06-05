// Agent 抽象：定义对外契约与运行期数据。AgentRegistry 用此类型注册具体实现。

/** Agent 唯一 ID，路由按 ID 查找。 */
export type AgentId = string;

/** 列出 agent 时展示的元数据。 */
export type AgentDescriptor = {
  id: AgentId;
  name: string;
  description: string;
  capabilities: string[];
};

/** 单次运行输入：归属哪个 agent、哪个 session、用户消息。 */
export type AgentRunInput = {
  agentId: AgentId;
  sessionId: string;
  message: ChatMessage;
};

/** 单次运行输出：assistant 回复 + 时间戳。 */
export type AgentRunOutput = {
  agentId: AgentId;
  sessionId: string;
  reply: ChatMessage;
  finishedAt: string;
};

import type { ChatMessage } from '../llm/types.js';

/**
 * Agent 接口：每个具体 agent（echo、tool-agent、os-agent 等）实现此接口。
 * 当前 run 是同步的，后续可扩展为 AsyncIterable 流式输出。
 */
export interface Agent {
  descriptor(): AgentDescriptor;
  run(input: AgentRunInput): Promise<AgentRunOutput>;
}
