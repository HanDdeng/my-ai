// 统一响应包装：所有 v3 起的 endpoint 走此形态。
// 成功：{ data, code: 0, message: 'ok' }  // 业务成功默认 message = 'ok'
// 业务成功但语义是"待处理"（如 /pair 202）：message 可传 'pair_pending' 等
// 业务错误：{ data: null, code, message }
// 错误 code 在调用方指定（HTTP 状态码或业务码）。
export type ApiResponse<T> =
  | { data: T; code: 0; message: 'ok' | string }
  | { data: null; code: number; message: string };

export function ok<T>(data: T, message: 'ok' | string = 'ok'): ApiResponse<T> {
  return { data, code: 0, message };
}

export function err(code: number, message: string): ApiResponse<null> {
  return { data: null, code, message };
}
