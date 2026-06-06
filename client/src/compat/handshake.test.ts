import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handshake, type HandshakeStatus } from './handshake.js';
import { COMPAT } from '../compat.generated.js';

const GATEWAY_URL = 'http://gateway.test';

describe('handshake', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetch 成功且 version 在范围内 → HEALTHY', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: true, service: 'gateway', version: '2.0.0', schema: 1 }),
            { status: 200 },
          ),
      ),
    );
    const result = await handshake(GATEWAY_URL, COMPAT);
    expect(result.status).toBe<HandshakeStatus>('HEALTHY');
    expect(result.version).toBe('2.0.0');
  });

  it('fetch 成功但 version 不在范围内 → MISMATCH', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: true, service: 'gateway', version: '1.0.0', schema: 1 }),
            { status: 200 },
          ),
      ),
    );
    const result = await handshake(GATEWAY_URL, COMPAT);
    expect(result.status).toBe<HandshakeStatus>('MISMATCH');
    expect(result.version).toBe('1.0.0');
  });

  it('schema 字段缺失 → MISMATCH（保守）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, service: 'gateway', version: '2.0.0' }), {
            status: 200,
          }),
      ),
    );
    const result = await handshake(GATEWAY_URL, COMPAT);
    expect(result.status).toBe<HandshakeStatus>('MISMATCH');
  });

  it('schema 字段非 1 → MISMATCH', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: true, service: 'gateway', version: '2.0.0', schema: 2 }),
            { status: 200 },
          ),
      ),
    );
    const result = await handshake(GATEWAY_URL, COMPAT);
    expect(result.status).toBe<HandshakeStatus>('MISMATCH');
  });

  it('fetch throw → PAIR_FAILED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      }),
    );
    const result = await handshake(GATEWAY_URL, COMPAT);
    expect(result.status).toBe<HandshakeStatus>('PAIR_FAILED');
  });

  it('HTTP 5xx → PAIR_FAILED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('server error', { status: 503 })),
    );
    const result = await handshake(GATEWAY_URL, COMPAT);
    expect(result.status).toBe<HandshakeStatus>('PAIR_FAILED');
  });
});
