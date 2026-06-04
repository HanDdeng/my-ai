import { request } from 'undici';

export type CoreClientOptions = {
  baseUrl: string;
  timeoutMs?: number;
};

export class CoreClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: CoreClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async health(): Promise<{ ok: boolean; service: string }> {
    const res = await request(`${this.baseUrl}/health`, {
      method: 'GET',
      headersTimeout: this.timeoutMs,
      bodyTimeout: this.timeoutMs,
    });
    if (res.statusCode >= 500) {
      return { ok: false, service: 'core' };
    }
    return (await res.body.json()) as { ok: boolean; service: string };
  }

  async forward(
    path: string,
    init: { method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'; body?: unknown; headers?: Record<string, string> },
  ) {
    const opts: Parameters<typeof request>[1] = {
      method: init.method,
      headers: {
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
      headersTimeout: this.timeoutMs,
      bodyTimeout: this.timeoutMs,
    };
    if (init.body !== undefined) {
      opts.body = JSON.stringify(init.body);
    }
    return request(`${this.baseUrl}${path}`, opts);
  }
}
