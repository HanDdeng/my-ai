// client/src/lib/agents 5 资源函数测试：URL 拼装 + HTTP 方法 + body 透传 + clientKey。
// mock 整个 api 模块（与 v5 PairDialog 测试风格一致）。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiFetch } from '@/lib/api.js';
import { listAgents, getAgent, createAgent, updateAgent, deleteAgent } from '@/lib/agents.js';

vi.mock('@/lib/api.js', () => ({
  apiFetch: vi.fn(),
}));

describe('client/src/lib/agents', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it('listAgents: GET /v1/agents + clientKey', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce([{ id: 'a1' }]);
    await listAgents('http://gw', 'ck');
    expect(apiFetch).toHaveBeenCalledWith('http://gw/v1/agents', { clientKey: 'ck' });
  });

  it('listAgents: 末尾 / 自动 trim', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce([]);
    await listAgents('http://gw/', 'ck');
    expect(apiFetch).toHaveBeenCalledWith('http://gw/v1/agents', { clientKey: 'ck' });
  });

  it('getAgent: GET /v1/agents/{id} (encodeURIComponent)', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ id: 'a/1' });
    await getAgent('http://gw', 'ck', 'a/1');
    expect(apiFetch).toHaveBeenCalledWith('http://gw/v1/agents/a%2F1', { clientKey: 'ck' });
  });

  it('createAgent: POST + body 含 randomUUID id + CreateAgentBody 字段', async () => {
    const spy = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001');
    vi.mocked(apiFetch).mockResolvedValueOnce({ id: '00000000-0000-4000-8000-000000000001' });
    await createAgent('http://gw', 'ck', {
      name: 'Echo',
      description: '',
      llmProvider: 'openai-compatible',
      baseUrl: 'http://x',
      model: 'qwen',
      maxTokens: null,
      // v6.3.1: 新增 contextWindow
      contextWindow: null,
      enabledApi: false,
      systemPrompt: '',
      capabilities: [],
    });
    expect(spy).toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledWith('http://gw/v1/agents', {
      method: 'POST',
      clientKey: 'ck',
      body: expect.objectContaining({ id: '00000000-0000-4000-8000-000000000001', name: 'Echo' }),
    });
    spy.mockRestore();
  });

  it('updateAgent: PATCH + body 为 UpdateAgentBody 子集', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ id: 'a1' });
    await updateAgent('http://gw', 'ck', 'a1', { name: 'Renamed' });
    expect(apiFetch).toHaveBeenCalledWith('http://gw/v1/agents/a1', {
      method: 'PATCH',
      clientKey: 'ck',
      body: { name: 'Renamed' },
    });
  });

  it('deleteAgent: DELETE', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(null);
    await deleteAgent('http://gw', 'ck', 'a1');
    expect(apiFetch).toHaveBeenCalledWith('http://gw/v1/agents/a1', {
      method: 'DELETE',
      clientKey: 'ck',
    });
  });
});
