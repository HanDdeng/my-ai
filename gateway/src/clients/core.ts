// 上游 core 的 HTTP 客户端：基于 undici，比 Node 内置 fetch 更轻、控时更细。
// v6.2：扩 9 个方法 + 统一 call() 辅助挂 X-Internal-Client-Key 头。
// clientKey 入参 = sha256 hash（v3 middleware req.clientCtx.id 字段；不做重哈希）。
// v6.2 (Option B)：call() 整包透传 core 的 {data, code, message}，不在 client 层解构；
// 路由 handler 按 status 决定 ok() 包装 (2xx) 还是原样透传 (4xx/5xx)。
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
    // v6.5: 默认对齐 config.ts CORE_TIMEOUT_MS default（640_000）；server.ts 启动时显式传入，
    //   未传时这里兜底防止退回到老的 15s 短超时。
    this.timeoutMs = opts.timeoutMs ?? 640_000;
  }

  /**
   * 统一调用入口：挂 X-Internal-Client-Key 头 + 整包透传 HTTP status / body。
   * - 2xx：返回 { status, body: <core 整包 {data, code: 0, message}> }
   * - 4xx/5xx：返回 { status, body: <core 整包 {data: null, code: 4xx/5xx, message}> }
   * - 204：body = null
   * - 网络错：throw Error（handler catch → 502 upstream_error）
   *
   * 路由层（agents/sessions/messages）按 status 决定 2xx 走 ok() 包装还是 4xx/5xx 真透传。
   */
  private async call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    clientKey: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    // body 字段在 exactOptionalPropertyTypes 下不能显式赋 undefined，用展开绕开。
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Client-Key': clientKey,
      },
      headersTimeout: this.timeoutMs,
      bodyTimeout: this.timeoutMs,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
    const res = await request(`${this.baseUrl}${path}`, opts);

    const status = res.statusCode;
    if (status === 204) {
      return { status, body: null };
    }
    // 整包保留：不解构 .data，handler 按 status 决定如何回包
    const parsedBody = (await res.body.json()) as unknown;
    return { status, body: parsedBody };
  }

  /**
   * 上游健康检查：5xx 视为 down，避免 core 启动中导致网关"假绿"。
   * v6.2 保留 v3 现状签名（不挂内部头；/health 是白名单）。
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

  // === agents（v3 现状 listAgents 改造 + 4 新 CRUD 方法）===

  async listAgents(clientKey: string): Promise<{ status: number; body: unknown }> {
    return this.call('GET', '/v1/agents', clientKey);
  }

  async createAgent(clientKey: string, body: unknown): Promise<{ status: number; body: unknown }> {
    return this.call('POST', '/v1/agents', clientKey, body);
  }

  async getAgent(clientKey: string, id: string): Promise<{ status: number; body: unknown }> {
    return this.call('GET', `/v1/agents/${encodeURIComponent(id)}`, clientKey);
  }

  async updateAgent(
    clientKey: string,
    id: string,
    body: unknown,
  ): Promise<{ status: number; body: unknown }> {
    return this.call('PATCH', `/v1/agents/${encodeURIComponent(id)}`, clientKey, body);
  }

  async deleteAgent(clientKey: string, id: string): Promise<{ status: number; body: unknown }> {
    return this.call('DELETE', `/v1/agents/${encodeURIComponent(id)}`, clientKey);
  }

  // === sessions（3 新方法）===

  async createSession(
    clientKey: string,
    body: unknown,
  ): Promise<{ status: number; body: unknown }> {
    return this.call('POST', '/v1/sessions', clientKey, body);
  }

  async getSession(clientKey: string, id: string): Promise<{ status: number; body: unknown }> {
    return this.call('GET', `/v1/sessions/${encodeURIComponent(id)}`, clientKey);
  }

  async deleteSession(clientKey: string, id: string): Promise<{ status: number; body: unknown }> {
    return this.call('DELETE', `/v1/sessions/${encodeURIComponent(id)}`, clientKey);
  }

  // === messages（2 新方法）===

  async listMessages(
    clientKey: string,
    sessionId: string,
  ): Promise<{ status: number; body: unknown }> {
    return this.call('GET', `/v1/sessions/${encodeURIComponent(sessionId)}/messages`, clientKey);
  }

  async postMessage(
    clientKey: string,
    sessionId: string,
    body: unknown,
  ): Promise<{ status: number; body: unknown }> {
    return this.call(
      'POST',
      `/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
      clientKey,
      body,
    );
  }
}
