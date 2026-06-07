// 网关鉴权白名单：/health、/pair、/pair/status、/internal/* 不走鉴权。
// /internal/* 在 route handler 内部额外检查 req.ip === '127.0.0.1'，中间件不做。
// 路径只做前缀匹配，query string 在 url 里一起传过来也要匹配上。
// 前缀边界：/health 只匹配 /health 和 /health/...，不能匹配 /healthcheck。
const PUBLIC_PATH_PREFIXES = ['/health', '/pair', '/internal/'];

export function isPublicPath(url: string): boolean {
  // 去掉 query string 再做前缀匹配（req.url 形如 "/pair/status?token=xxx"）
  const path = url.split('?')[0] ?? url;
  return PUBLIC_PATH_PREFIXES.some(p => {
    if (path === p) {
      return true;
    }
    // 以 / 结尾的前缀直接 startsWith；否则要求紧跟 / 才是子路径。
    const boundary = p.endsWith('/') ? p : p + '/';
    return path.startsWith(boundary);
  });
}
