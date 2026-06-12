// client/src/lib/messages 2 资源函数测试。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiFetch } from '@/lib/api.js';
import { listMessages, postMessage } from '@/lib/messages.js';

vi.mock('@/lib/api.js', () => ({
  apiFetch: vi.fn(),
}));

describe('client/src/lib/messages', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it('listMessages: GET /v1/sessions/{sessionId}/messages', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce([]);
    await listMessages('http://gw', 'ck', 's1');
    expect(apiFetch).toHaveBeenCalledWith('http://gw/v1/sessions/s1/messages', {
      clientKey: 'ck',
    });
  });

  it('postMessage: POST + body 含 id (randomUUID) + content', async () => {
    const spy = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000003');
    vi.mocked(apiFetch).mockResolvedValueOnce({
      userMessage: {
        id: '00000000-0000-4000-8000-000000000003',
        sessionId: 's1',
        role: 'user',
        content: 'hi',
        createdAt: 't',
      },
      assistantMessage: {
        id: 'am1',
        sessionId: 's1',
        role: 'assistant',
        content: 'echo',
        createdAt: 't',
      },
    });
    const result = await postMessage('http://gw', 'ck', 's1', 'hi');
    expect(spy).toHaveBeenCalled();
    // v6.4: reasoningEffort 由消息接口传（client 暂时硬编码 'none'）。
    expect(apiFetch).toHaveBeenCalledWith('http://gw/v1/sessions/s1/messages', {
      method: 'POST',
      clientKey: 'ck',
      body: {
        id: '00000000-0000-4000-8000-000000000003',
        content: 'hi',
        reasoningEffort: 'none',
      },
    });
    expect(result.assistantMessage.content).toBe('echo');
    spy.mockRestore();
  });

  it('sessionId 含 / 时 URL encode', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce([]);
    await listMessages('http://gw', 'ck', 's/1');
    expect(apiFetch).toHaveBeenCalledWith('http://gw/v1/sessions/s%2F1/messages', {
      clientKey: 'ck',
    });
  });
});
