import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAICompatibleLLMClient } from '@/llm/openai-compatible.js';
import { LLMUpstreamError } from '@/llm/errors.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OpenAICompatibleLLMClient', () => {
  it('HTTP 200 + 合法响应 → 解析 content + usage', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'hi back' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAICompatibleLLMClient({
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen2.5:7b',
    });

    const res = await client.chat({
      model: 'qwen2.5:7b',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(res.content).toBe('hi back');
    expect(res.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });

    // 验证 fetch 调用形态
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('qwen2.5:7b');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.stream).toBe(false);
  });

  it('apiKey 缺失 → 不发 Authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'x' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAICompatibleLLMClient({ baseUrl: 'http://x/v1', model: 'm' });
    await client.chat({ model: 'm', messages: [] });

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('apiKey 存在 → 发 Bearer', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'x' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAICompatibleLLMClient({
      baseUrl: 'http://x/v1',
      model: 'm',
      apiKey: 'sk-test',
    });
    await client.chat({ model: 'm', messages: [] });

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test');
  });

  it('baseUrl 末尾 / 去掉再拼 /chat/completions', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'x' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAICompatibleLLMClient({ baseUrl: 'http://x/v1/', model: 'm' });
    await client.chat({ model: 'm', messages: [] });

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://x/v1/chat/completions');
  });

  it('HTTP 5xx → 抛 LLMUpstreamError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'internal error',
      }),
    );

    const client = new OpenAICompatibleLLMClient({ baseUrl: 'http://x/v1', model: 'm' });
    await expect(client.chat({ model: 'm', messages: [] })).rejects.toBeInstanceOf(
      LLMUpstreamError,
    );
  });

  it('响应不是 JSON → 抛 LLMUpstreamError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('bad json');
        },
      }),
    );

    const client = new OpenAICompatibleLLMClient({ baseUrl: 'http://x/v1', model: 'm' });
    await expect(client.chat({ model: 'm', messages: [] })).rejects.toBeInstanceOf(
      LLMUpstreamError,
    );
  });

  it('响应缺 choices[0].message.content → 抛 LLMUpstreamError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [] }),
      }),
    );

    const client = new OpenAICompatibleLLMClient({ baseUrl: 'http://x/v1', model: 'm' });
    await expect(client.chat({ model: 'm', messages: [] })).rejects.toBeInstanceOf(
      LLMUpstreamError,
    );
  });

  it('网络错 → 抛 LLMUpstreamError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED')));

    const client = new OpenAICompatibleLLMClient({ baseUrl: 'http://x/v1', model: 'm' });
    await expect(client.chat({ model: 'm', messages: [] })).rejects.toBeInstanceOf(
      LLMUpstreamError,
    );
  });

  it('req.maxTokens 优先于 cfg.maxTokens', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'x' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAICompatibleLLMClient({
      baseUrl: 'http://x/v1',
      model: 'm',
      maxTokens: 1000,
    });
    await client.chat({ model: 'm', messages: [], maxTokens: 500 });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    // v6.3.2: 改用 OpenAI 新 SDK 字段名 max_completion_tokens。
    expect(body.max_completion_tokens).toBe(500);
    expect(body.max_tokens).toBeUndefined();
  });

  it('cfg.maxTokens 存在 + req.maxTokens 缺失 → body.max_completion_tokens = cfg.maxTokens', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'x' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAICompatibleLLMClient({
      baseUrl: 'http://x/v1',
      model: 'm',
      maxTokens: 4000,
    });
    await client.chat({ model: 'm', messages: [] });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('m');
    expect(body.messages).toEqual([]);
    expect(body.max_completion_tokens).toBe(4000);
    expect(body.stream).toBe(false);
  });

  it('全缺（req/cfg 都没 maxTokens）→ 兜底 4096', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'x' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAICompatibleLLMClient({ baseUrl: 'http://x/v1', model: 'm' });
    await client.chat({ model: 'm', messages: [] });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.max_completion_tokens).toBe(4096);
  });

  it('v6.3.2: reasoningEffort 写入 body.reasoning_effort', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'x' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAICompatibleLLMClient({
      baseUrl: 'http://x/v1',
      model: 'o1',
      reasoningEffort: 'high',
    });
    await client.chat({ model: 'o1', messages: [] });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.reasoning_effort).toBe('high');
  });

  it('v6.3.2: reasoningEffort = "none" 也写入 body（默认行为）', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'x' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAICompatibleLLMClient({
      baseUrl: 'http://x/v1',
      model: 'o1',
      reasoningEffort: 'none',
    });
    await client.chat({ model: 'o1', messages: [] });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.reasoning_effort).toBe('none');
  });

  it('v6.3.2: reasoningEffort 未设 → body 不含 reasoning_effort（Ollama 等不兼容 provider 不报错）', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'x' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAICompatibleLLMClient({ baseUrl: 'http://x/v1', model: 'm' });
    await client.chat({ model: 'm', messages: [] });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('协议层只发 OpenAI 标准字段：body 不包含 num_ctx 等 provider 私有键', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'x' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAICompatibleLLMClient({
      baseUrl: 'http://x/v1',
      model: 'm',
      maxTokens: 4000,
    });
    await client.chat({ model: 'm', messages: [] });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    // 关键断言：contextWindow 不进协议层
    expect(body.num_ctx).toBeUndefined();
    // 兜底：body 只有 OpenAI 标准键（v6.3.2 多了 reasoning_effort 可能；这里 cfg 未设 → 不在）
    expect(Object.keys(body).sort()).toEqual([
      'max_completion_tokens',
      'messages',
      'model',
      'stream',
    ]);
  });

  it('v6.3.2: reasoningEffort 存在时 body 包含 reasoning_effort（协议层透传）', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'x' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAICompatibleLLMClient({
      baseUrl: 'http://x/v1',
      model: 'o1',
      maxTokens: 4000,
      reasoningEffort: 'medium',
    });
    await client.chat({ model: 'o1', messages: [] });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(Object.keys(body).sort()).toEqual([
      'max_completion_tokens',
      'messages',
      'model',
      'reasoning_effort',
      'stream',
    ]);
  });
});
