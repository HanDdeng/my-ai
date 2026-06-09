// 客户端 UUID 工具：生成 RFC 4122 v4 字符串。
// 优先用 crypto.randomUUID（现代浏览器 / secure context 可用）；
// 缺失时回退到 crypto.getRandomValues 自实现（兼容 Safari < 15.4 等老环境）；
// 极端情况（无 crypto）再走 Math.random。
// 关键场景：配对草稿 key 在 useState 初始化函数中生成，旧 Safari / 非 secure context
// 下 crypto.randomUUID 缺失会直接抛 TypeError 白屏，所以必须有兜底。
export function randomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    // RFC 4122 v4：version (4) 写高 4 位，variant (10xx) 写高 2 位。
    // Uint8Array(16) 必有 index 6/8，用 ! 收敛 noUncheckedIndexedAccess。
    buf[6] = (buf[6]! & 0x0f) | 0x40;
    buf[8] = (buf[8]! & 0x3f) | 0x80;
    const hex = Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // 终局兜底：极旧环境（无 crypto.getRandomValues）下用 Math.random。
  // 仅用于本地配对草稿 key，不参与鉴权 / 安全敏感路径。
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
