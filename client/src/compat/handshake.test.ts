// 关键差异（v3）：响应改为 { data: {ok, service, version, schema}, code, message }。
// 握手函数多了一个 clientKey 形参，未配对时传 null。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handshake, type HandshakeStatus } from './handshake.js';
import { COMPAT } from '../compat.generated.js';

const GATEWAY_URL = 'http://gateway.test';

function mockOk(version: string) {
  return new Response(
    JSON.stringify({
      data: { ok: true, service: 'gateway', version, schema: 1 },
      code: 0,
      message: 'ok',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('handshake', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetch 成功且 version 在范围内 → HEALTHY', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockOk('0.0.2')),
    );
    const result = await handshake(GATEWAY_URL, COMPAT, null);
    expect(result.status).toBe<HandshakeStatus>('HEALTHY');
    expect(result.version).toBe('0.0.2');
  });

  it('fetch 成功但 version 不在范围内 → MISMATCH', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockOk('1.0.0')),
    );
    const result = await handshake(GATEWAY_URL, COMPAT, null);
    expect(result.status).toBe<HandshakeStatus>('MISMATCH');
    expect(result.version).toBe('1.0.0');
  });

  it('schema 字段缺失 → MISMATCH（保守）', async () => {
    // 响应里没有 data.schema：按新格式解出来是 undefined，触发 MISMATCH。
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: { ok: true, service: 'gateway', version: '2.0.0' },
              code: 0,
              message: 'ok',
            }),
            { status: 200 },
          ),
      ),
    );
    const result = await handshake(GATEWAY_URL, COMPAT, null);
    expect(result.status).toBe<HandshakeStatus>('MISMATCH');
  });

  it('schema 字段非 1 → MISMATCH', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: { ok: true, service: 'gateway', version: '2.0.0', schema: 2 },
              code: 0,
              message: 'ok',
            }),
            { status: 200 },
          ),
      ),
    );
    const result = await handshake(GATEWAY_URL, COMPAT, null);
    expect(result.status).toBe<HandshakeStatus>('MISMATCH');
  });

  it('fetch throw → PAIR_FAILED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      }),
    );
    const result = await handshake(GATEWAY_URL, COMPAT, null);
    expect(result.status).toBe<HandshakeStatus>('PAIR_FAILED');
  });

  it('HTTP 5xx → PAIR_FAILED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('server error', { status: 503 })),
    );
    const result = await handshake(GATEWAY_URL, COMPAT, null);
    expect(result.status).toBe<HandshakeStatus>('PAIR_FAILED');
  });

  it('有 clientKey 时 fetch 带 X-Client-Key 头', async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () => mockOk('0.0.2'));
    vi.stubGlobal('fetch', fetchSpy);
    await handshake(GATEWAY_URL, COMPAT, 'my-client-key-abc');
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['x-client-key']).toBe('my-client-key-abc');
  });
});
