// Agent 注册表：用 Map 提供 O(1) 查找，构造期由 buildServer() 注入所有 agent。
import type { Agent, AgentDescriptor, AgentId } from './types.js';

export class AgentRegistry {
  private readonly map = new Map<AgentId, Agent>();

  /**
   * 注册一个 agent；id 由 agent.descriptor().id 决定，重复注册会覆盖。
   */
  register(agent: Agent): void {
    this.map.set(agent.descriptor().id, agent);
  }

  /**
   * 按 id 取 agent；找不到返回 undefined，由调用方决定 404 还是降级。
   */
  get(id: AgentId): Agent | undefined {
    return this.map.get(id);
  }

  /**
   * 列出所有 agent 的 descriptor（不含具体实现），用于对外暴露。
   */
  list(): AgentDescriptor[] {
    return [...this.map.values()].map((a) => a.descriptor());
  }
}
