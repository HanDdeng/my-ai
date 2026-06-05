// 上游 core 的 HTTP 客户端：基于 undici，比 Node 内置 fetch 更轻、控时更细。
import { request } from 'undici';

export type CoreClientOptions = {
  baseUrl: string;
  timeoutMs?: number;
};

/**
 * 包装对 core 的请求；网关层不解析业务，只做透传 + 错误透出。
 */
export class CoreClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: CoreClientOptions) {
    // 去掉尾部斜线，避免拼接出 xxx//path。
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /**
   * 上游健康检查：5xx 视为 down，避免 core 启动中导致网关"假绿"。
   */
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

  /**
   * 透传任意 HTTP 方法到 core：网关层路由把 client 请求原样转发。
   * @param path 上游路径
   * @param init 方法/请求体/请求头
   */
  async forward(
    path: string,
    init: {
      method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      body?: unknown;
      headers?: Record<string, string>;
    },
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
