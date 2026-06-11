// 5 资源函数：list / get / create / update / delete agent。
// 调 v6.2 gateway 透传的 v6.1 core 端 5 端点；URL 拼装 + randomUUID() 用于 create。
import { apiFetch } from './api.js';
import { randomUUID } from './uuid.js';
import type { Agent, CreateAgentBody, UpdateAgentBody } from './types.js';

const url = (gw: string, path: string): string => `${gw.replace(/\/+$/, '')}${path}`;

export function listAgents(gw: string, ck: string): Promise<Agent[]> {
  return apiFetch<Agent[]>(url(gw, '/v1/agents'), { clientKey: ck });
}

export function getAgent(gw: string, ck: string, id: string): Promise<Agent> {
  return apiFetch<Agent>(url(gw, `/v1/agents/${encodeURIComponent(id)}`), { clientKey: ck });
}

export function createAgent(gw: string, ck: string, body: CreateAgentBody): Promise<Agent> {
  return apiFetch<Agent>(url(gw, '/v1/agents'), {
    method: 'POST',
    clientKey: ck,
    body: { id: randomUUID(), ...body },
  });
}

export function updateAgent(
  gw: string,
  ck: string,
  id: string,
  body: UpdateAgentBody,
): Promise<Agent> {
  return apiFetch<Agent>(url(gw, `/v1/agents/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    clientKey: ck,
    body,
  });
}

export function deleteAgent(gw: string, ck: string, id: string): Promise<null> {
  return apiFetch<null>(url(gw, `/v1/agents/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    clientKey: ck,
  });
}
