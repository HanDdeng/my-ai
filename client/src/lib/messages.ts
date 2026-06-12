// 2 资源函数：list / post messages（session 内）。
// 调 v6.2 gateway 透传的 v6.1 core 端 2 端点；postMessage 自动生成 userMessageId。
// v6.4: 消息体加 reasoningEffort（v6.4 起作为请求参数；表单暂未提供，硬编码 'none'）。
import { apiFetch } from './api.js';
import { randomUUID } from './uuid.js';
import type { Message, PostMessageResponse } from './types.js';

const url = (gw: string, path: string): string => `${gw.replace(/\/+$/, '')}${path}`;

export function listMessages(gw: string, ck: string, sessionId: string): Promise<Message[]> {
  return apiFetch<Message[]>(url(gw, `/v1/sessions/${encodeURIComponent(sessionId)}/messages`), {
    clientKey: ck,
  });
}

export function postMessage(
  gw: string,
  ck: string,
  sessionId: string,
  content: string,
): Promise<PostMessageResponse> {
  return apiFetch<PostMessageResponse>(
    url(gw, `/v1/sessions/${encodeURIComponent(sessionId)}/messages`),
    {
      method: 'POST',
      clientKey: ck,
      // v6.4: 思考强度暂时硬编码 'none'，等表单提供选择器后再接。
      body: { id: randomUUID(), content, reasoningEffort: 'none' as const },
    },
  );
}
