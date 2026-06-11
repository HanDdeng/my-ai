// api.ts 单元测试：覆盖 200 解析 + 4xx 抛 ApiError + 解析失败抛 ParseError。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiFetch, ApiError, ParseError } from '@/lib/api.js';

describe('apiFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('200 响应解析 data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { foo: 1 }, code: 0, message: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const got = await apiFetch<{ foo: number }>('http://x/foo');
    expect(got).toEqual({ foo: 1 });
  });

  it('4xx 响应抛 ApiError 且带 data 字段', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ data: { reason: 'expired' }, code: 401, message: 'invalid_key' }),
          {
            status: 401,
            headers: { 'content-type': 'application/json' },
          },
        ),
      ),
    );
    try {
      await apiFetch('http://x/foo');
      expect.fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe(401);
      expect((e as ApiError).data).toEqual({ reason: 'expired' });
    }
  });

  // 202 + code:0 + message !== 'ok'：业务"待处理"（如 /pair 202 pair_pending），
  // 应抛 ApiError(0, message, data) 让调用方从 e.data 取 token。
  it('202 + code 0 + 非 ok 消息抛 ApiError（pair_pending 之类）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { token: 'abc123', expiresAt: 1234567890 },
            code: 0,
            message: 'pair_pending',
          }),
          { status: 202, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    try {
      await apiFetch('http://x/pair');
      expect.fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe(0);
      expect((e as ApiError).message).toBe('pair_pending');
      expect((e as ApiError).data).toEqual({ token: 'abc123', expiresAt: 1234567890 });
    }
  });

  it('解析失败抛 ParseError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
    await expect(apiFetch('http://x/foo')).rejects.toThrow(ParseError);
  });

  it('带 X-Client-Key header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: null, code: 0, message: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('http://x/foo', { clientKey: 'abc' });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-client-key']).toBe('abc');
  });

  // 规范化 URL：用户在 PairDialog 经常只填 host:port 或带末尾 /，
  // apiFetch 要补 http:// 并去末尾 /，避免 fetch 走错机器或拼出 //xxx。
  describe('URL 规范化', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: null, code: 0, message: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);
    });

    it('裸 host:port 自动补 http://', async () => {
      await apiFetch('192.168.31.97:8787/health');
      expect(fetchMock.mock.calls[0]?.[0]).toBe('http://192.168.31.97:8787/health');
    });

    it('已带 http:// 不重复补', async () => {
      await apiFetch('http://x:8787/health');
      expect(fetchMock.mock.calls[0]?.[0]).toBe('http://x:8787/health');
    });

    it('已带 https:// 保留', async () => {
      await apiFetch('https://x/health');
      expect(fetchMock.mock.calls[0]?.[0]).toBe('https://x/health');
    });

    it('URL 末尾 / 去掉（避免和 ${url}/path 拼出 //path）', async () => {
      // PairDialog 端会拼 ${url}/health；这里直接测带末尾 / 的输入。
      await apiFetch('http://x:8787/');
      expect(fetchMock.mock.calls[0]?.[0]).toBe('http://x:8787');
    });

    it('前后空白 trim', async () => {
      await apiFetch('   http://x:8787/health   ');
      expect(fetchMock.mock.calls[0]?.[0]).toBe('http://x:8787/health');
    });
  });

  // v6.3：apiFetch method 类型加 PATCH，让前端 PATCH /v1/agents/{id} 走类型化。
  it('PATCH 方法透传：method=PATCH 走 fetch', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { id: 'a1' }, code: 0, message: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await apiFetch<{ id: string }>('http://gw/v1/agents/a1', {
      method: 'PATCH',
      clientKey: 'ck',
      body: { name: 'Renamed' },
    });
    expect(result).toEqual({ id: 'a1' });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://gw/v1/agents/a1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed' }),
      }),
    );
  });

  // 边缘情况 1：fetch 200 但 body 非 JSON → 抛 ParseError（不是 ApiError）。
  it('ParseError: 非 JSON 响应体抛 ParseError（不是 ApiError）', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response('not json at all', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    await expect(apiFetch('http://gw/x', { clientKey: 'ck' })).rejects.toBeInstanceOf(ParseError);
  });

  // 边缘情况 2：HTTP 4xx + 合法 envelope → ApiError 透传 status/code/message。
  it('4xx + 合法 envelope: 透传 status + code + message', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: null, code: 400, message: 'invalid_body' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );
    try {
      await apiFetch('http://gw/x', { clientKey: 'ck' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe(400);
      expect((e as ApiError).message).toBe('invalid_body');
    }
  });

  // 边缘情况 3：HTTP 5xx + 合法 envelope → ApiError 透传 status/code/message。
  it('5xx + 合法 envelope: 透传 status + code + message', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: null, code: 502, message: 'upstream_error' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      }),
    );
    try {
      await apiFetch('http://gw/x', { clientKey: 'ck' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe(502);
      expect((e as ApiError).message).toBe('upstream_error');
    }
  });

  // 边缘情况 4：HTTP 4xx + envelope message 为空字符串 → ApiError(400, "") 透传，
  // 让 friendlyApiError 走默认 fallback（"错误码 400" 之类）。
  it('4xx + envelope message 为空字符串: 抛 ApiError(400, "")', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: null, code: 400, message: '' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );
    try {
      await apiFetch('http://gw/x', { clientKey: 'ck' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe(400);
      expect((e as ApiError).message).toBe('');
    }
  });
});
