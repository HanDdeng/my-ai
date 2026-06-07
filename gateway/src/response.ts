// 统一响应包装：所有 v3 起的 endpoint 走此形态。
// 成功：{ data, code: 0, message: 'ok' }
// 业务错误：{ data: null, code, message }
// 错误 code 在调用方指定（HTTP 状态码或业务码）。
export type ApiResponse<T> =
  | { data: T; code: 0; message: 'ok' }
  | { data: null; code: number; message: string };

export function ok<T>(data: T): ApiResponse<T> {
  return { data, code: 0, message: 'ok' };
}

export function err(code: number, message: string): ApiResponse<null> {
  return { data: null, code, message };
}
