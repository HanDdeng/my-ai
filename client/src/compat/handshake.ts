// client 端握手：调 gateway /health，解析 version，对照 compat range。
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
export async function handshake(gatewayUrl: string, compat: Compat): Promise<HandshakeResult> {
  let res: Response;
  try {
    res = await fetch(`${gatewayUrl}/health`);
  } catch {
    return { status: 'PAIR_FAILED', version: null };
  }
  if (!res.ok) {
    return { status: 'PAIR_FAILED', version: null };
  }
  let body: { ok?: boolean; service?: string; version?: string; schema?: number };
  try {
    body = await res.json();
  } catch {
    return { status: 'MISMATCH', version: null };
  }
  if (body.schema !== 1 || typeof body.version !== 'string') {
    return { status: 'MISMATCH', version: body.version ?? null };
  }
  const want = compat.upstream.gateway;
  if (!want) {
    // compat 里没声明 gateway 范围：保守视为不兼容
    return { status: 'MISMATCH', version: body.version };
  }
  const inRange = checkCompat(body.version, want);
  return {
    status: inRange ? 'HEALTHY' : 'MISMATCH',
    version: body.version,
  };
}
