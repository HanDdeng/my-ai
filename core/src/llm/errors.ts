// LLM 层错误：factory 未注册 provider 抛 NotImplemented；HTTP/响应错抛 Upstream。
// 路由层 setErrorHandler 捕获，分别转 501 / 502。
export class LLMNotImplementedError extends Error {
  constructor(public readonly provider: string) {
    super(`LLM provider not implemented: ${provider}`);
    this.name = 'LLMNotImplementedError';
  }
}

export class LLMUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMUpstreamError';
  }
}
