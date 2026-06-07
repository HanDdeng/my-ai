// client 端握手：调 gateway /health（v3 起新格式），解析 data.version。
// 带 X-Client-Key 头（v3 起的鉴权要求；/health 公开但加 header 不影响）。
import { checkCompat } from './check.js';
import type { COMPAT } from '../compat.generated.js';

type Compat = typeof COMPAT;

export type HandshakeStatus = 'PAIRING' | 'HEALTHY' | 'MISMATCH' | 'PAIR_FAILED';

export type HandshakeResult = {
  status: HandshakeStatus;
  version: string | null;
};

/**
 * 发起一次握手。返回结果包含状态和拿到的 version（用于 UI 展示）。
 * 不抛错：所有错误转为 PAIR_FAILED 或 MISMATCH（保守路径）。
 */
export async function handshake(
  gatewayUrl: string,
  compat: Compat,
  clientKey: string | null,
): Promise<HandshakeResult> {
  const headers: Record<string, string> = {};
  if (clientKey) {
    headers['x-client-key'] = clientKey;
  }
  let res: Response;
  try {
    res = await fetch(`${gatewayUrl}/health`, { headers });
  } catch {
    return { status: 'PAIR_FAILED', version: null };
  }
  if (!res.ok) {
    return { status: 'PAIR_FAILED', version: null };
  }
  let body: { data?: { version?: string; schema?: number }; code?: number };
  try {
    body = await res.json();
  } catch {
    return { status: 'MISMATCH', version: null };
  }
  const inner = body.data;
  if (typeof inner?.version !== 'string' || inner.schema !== 1) {
    return { status: 'MISMATCH', version: inner?.version ?? null };
  }
  const want = compat.upstream.gateway;
  if (!want) {
    return { status: 'MISMATCH', version: inner.version };
  }
  const inRange = checkCompat(inner.version, want);
  return {
    status: inRange ? 'HEALTHY' : 'MISMATCH',
    version: inner.version,
  };
}
