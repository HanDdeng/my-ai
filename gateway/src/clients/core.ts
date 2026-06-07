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
   * 列出上游 agents：v3 起 core 走新响应包装，返回 data 字段。
   */
  async listAgents(): Promise<unknown[]> {
    const res = await request(`${this.baseUrl}/v1/agents`, {
      method: 'GET',
      headersTimeout: this.timeoutMs,
      bodyTimeout: this.timeoutMs,
    });
    if (res.statusCode !== 200) {
      throw new Error(`core /v1/agents ${res.statusCode}`);
    }
    const body = (await res.body.json()) as { data?: unknown[] };
    return body.data ?? [];
  }
}
