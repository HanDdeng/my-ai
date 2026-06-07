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
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT';
  body?: unknown;
  clientKey?: string | null;
};

export async function apiFetch<T>(url: string, opts: ApiFetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.clientKey) {
    headers['x-client-key'] = opts.clientKey;
  }
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers,
  };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, init);
  let body: ApiEnvelope<T>;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new ParseError(`invalid JSON response from ${url}`);
  }
  if (body.code !== 0 || !res.ok) {
    throw new ApiError(body.code, body.message, body.data);
  }
  return body.data as T;
}
