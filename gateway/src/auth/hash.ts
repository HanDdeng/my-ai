// 网关用的 SHA-256 hash 工具：把 clientKey 算成 hex，存 DB 时用 hash 比对。
// 使用 Node 内置 crypto，零外部依赖；hex 编码便于人工核对。
import { createHash } from 'node:crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
