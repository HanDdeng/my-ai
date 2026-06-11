// client/src/lib/sessions 3 资源函数测试。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiFetch } from '@/lib/api.js';
import { createSession, getSession, deleteSession } from '@/lib/sessions.js';

vi.mock('@/lib/api.js', () => ({
  apiFetch: vi.fn(),
}));

describe('client/src/lib/sessions', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it('createSession: POST + body 含 id (randomUUID) + agentId', async () => {
    const spy = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');
    vi.mocked(apiFetch).mockResolvedValueOnce({ id: '00000000-0000-4000-8000-000000000002' });
    await createSession('http://gw', 'ck', 'a1');
    expect(spy).toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledWith('http://gw/v1/sessions', {
      method: 'POST',
      clientKey: 'ck',
      body: { id: '00000000-0000-4000-8000-000000000002', agentId: 'a1' },
    });
    spy.mockRestore();
  });

  it('getSession: GET /v1/sessions/{id}', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ id: 's1' });
    await getSession('http://gw', 'ck', 's1');
    expect(apiFetch).toHaveBeenCalledWith('http://gw/v1/sessions/s1', { clientKey: 'ck' });
  });

  it('deleteSession: DELETE', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(null);
    await deleteSession('http://gw', 'ck', 's1');
    expect(apiFetch).toHaveBeenCalledWith('http://gw/v1/sessions/s1', {
      method: 'DELETE',
      clientKey: 'ck',
    });
  });

  it('id 含 / 时 URL encode', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ id: 's/1' });
    await getSession('http://gw', 'ck', 's/1');
    expect(apiFetch).toHaveBeenCalledWith('http://gw/v1/sessions/s%2F1', { clientKey: 'ck' });
  });
});
