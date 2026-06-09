// 核心侧统一响应包装：与 gateway/src/response.ts 保持一致。
// v3 阶段 core 只有 /health 一个 endpoint，未来加端点时同样用 ok/err。
export type ApiResponse<T> =
  | { data: T; code: 0; message: 'ok' }
  | { data: null; code: number; message: string };

export function ok<T>(data: T): ApiResponse<T> {
  return { data, code: 0, message: 'ok' };
}

export function err(code: number, message: string): ApiResponse<null> {
  return { data: null, code, message };
}
