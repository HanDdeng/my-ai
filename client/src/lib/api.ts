// client 端 fetch 包装：解析统一响应 + 抛 ApiError / ParseError。
// v3 起所有 endpoint 走 {data, code, message}，client 用此统一解析。
// ApiError 带 data 字段：202 等"业务码为 0 但 HTTP 非 200"的场景需要从 data 取 token 等信息。
export class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
    public data: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

type ApiEnvelope<T> =
  | { data: T; code: 0; message: 'ok' }
  | { data: null; code: number; message: string };

export type ApiFetchOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; // v6.3: 加 'PATCH'
  body?: unknown;
  clientKey?: string | null;
  // v6.5: 调用方可传 AbortSignal 取消 fetch（用于"发送中按取消"等场景）
  signal?: AbortSignal;
};

// 规范化 URL：trim、自动补 http://、去末尾多余 /。
// 用户在 PairDialog 经常只填 host:port，自动补协议避免 fetch 把无 scheme
// URL 当成相对路径或路由到错的机器；末尾 / 跟 ${url}/xxx 拼接会变 //xxx。
function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return trimmed;
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

export async function apiFetch<T>(url: string, opts: ApiFetchOptions = {}): Promise<T> {
  const normalizedUrl = normalizeUrl(url);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.clientKey) {
    headers['x-client-key'] = opts.clientKey;
  }
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers,
  };
  // v6.5: 透传 AbortSignal（外部取消时立即 abort fetch）
  if (opts.signal) {
    init.signal = opts.signal;
  }
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(normalizedUrl, init);
  let body: ApiEnvelope<T>;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new ParseError(`invalid JSON response from ${url}`);
  }
  // 三种情况抛 ApiError：
  //   1) code !== 0      业务错误
  //   2) !res.ok         HTTP 状态非 2xx
  //   3) code === 0 && message !== 'ok'  业务码 0 但语义"待处理"（如 /pair 202 pair_pending）
  //      → 抛 ApiError(0, message, data) 让调用方从 e.data 取 token / 后续信息
  if (body.code !== 0 || !res.ok || body.message !== 'ok') {
    throw new ApiError(body.code, body.message, body.data);
  }
  return body.data as T;
}
