import type { Agent, AgentDescriptor, AgentId } from './types.js';

export class AgentRegistry {
  private readonly map = new Map<AgentId, Agent>();

  register(agent: Agent): void {
    this.map.set(agent.descriptor().id, agent);
  }

  get(id: AgentId): Agent | undefined {
    return this.map.get(id);
  }

  list(): AgentDescriptor[] {
    return [...this.map.values()].map((a) => a.descriptor());
  }
}
