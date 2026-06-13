// 3 资源函数：create / get / delete session。
// 调 v6.2 gateway 透传的 v6.1 core 端 3 端点；createSession 自动生成 sessionId。
import { apiFetch } from './api.js';
import { randomUUID } from './uuid.js';
import type { Session } from './types.js';

const url = (gw: string, path: string): string => `${gw.replace(/\/+$/, '')}${path}`;

export function createSession(gw: string, ck: string, agentId: string): Promise<Session> {
  return apiFetch<Session>(url(gw, '/v1/sessions'), {
    method: 'POST',
    clientKey: ck,
    body: { id: randomUUID(), agentId },
  });
}

export function getSession(gw: string, ck: string, id: string): Promise<Session> {
  return apiFetch<Session>(url(gw, `/v1/sessions/${encodeURIComponent(id)}`), {
    clientKey: ck,
  });
}

export function deleteSession(gw: string, ck: string, id: string): Promise<null> {
  return apiFetch<null>(url(gw, `/v1/sessions/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    clientKey: ck,
  });
}
