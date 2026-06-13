// 结构化 HTTP 错误：DAO / 业务层抛，路由层 setErrorHandler 捕获并转响应。
// v6.1 新增；v1 没有结构化错误（用 plain Error + 手写状态码）。
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = 'HttpError';
  }
}
