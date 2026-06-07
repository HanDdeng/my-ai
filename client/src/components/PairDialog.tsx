// 配对弹出层：表单 + 提交 → GET /health 探活 → POST /pair → 成功/轮询。
// v3 阶段简化 UI：3 个 input + 1 个 submit 按钮 + 状态文字。
import { useState } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';
import { saveSecureConfig } from '../lib/secure-store.js';

type Props = {
  initialUrl: string;
  initialPairKey?: string | null;
  initialName?: string | null;
  clientKey: string;
  onPaired: (info: { clientKey: string; name: string | null }) => void;
  onClose: () => void;
};

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export function PairDialog({
  initialUrl,
  initialPairKey = null,
  initialName = null,
  clientKey,
  onPaired,
  onClose,
}: Props) {
  const [url, setUrl] = useState(initialUrl);
  const [pairKey, setPairKey] = useState(initialPairKey ?? '');
  const [name, setName] = useState(initialName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setStatus('探活中…');
    try {
      await apiFetch(`${url}/health`, { clientKey });
    } catch (e) {
      setError(`网关不可达: ${(e as Error).message}`);
      setStatus(null);
      return;
    }
    setStatus('配对中…');
    try {
      const data = await apiFetch<{ clientKey: string; name: string | null }>(`${url}/pair`, {
        method: 'POST',
        clientKey,
        body: { clientKey, name: name || null, pairKey: pairKey || undefined },
      });
      await saveSecureConfig({
        clientKey: data.clientKey,
        gatewayUrl: url,
        pairKey: pairKey || null,
        clientName: data.name,
      });
      onPaired({ clientKey: data.clientKey, name: data.name });
      return;
    } catch (e) {
      if (e instanceof ApiError && e.code === 0) {
        // 202 pair_pending：从 e.data 取 token，进入轮询
        const token = (e.data as { token?: string } | null)?.token;
        if (!token) {
          setError('配对失败: 响应缺少 token');
          setStatus(null);
          return;
        }
        setStatus('等待 CLI 解析…');
        let stopped = false;
        const poll = async () => {
          if (stopped) {
            return;
          }
          try {
            const r = await apiFetch<{ status: string }>(`${url}/pair/status?token=${token}`);
            if (r.status === 'PAIRED') {
              stopped = true;
              await saveSecureConfig({
                clientKey,
                gatewayUrl: url,
                pairKey: pairKey || null,
                clientName: name || null,
              });
              onPaired({ clientKey, name: name || null });
            }
          } catch {
            // ignore, retry on next interval
          }
        };
        const id = setInterval(poll, POLL_INTERVAL_MS);
        setTimeout(() => {
          stopped = true;
          clearInterval(id);
          if (status === '等待 CLI 解析…') {
            setError('配对超时（5min），请重试');
            setStatus(null);
          }
        }, POLL_TIMEOUT_MS);
        void poll();
        return;
      }
      setError(`配对失败: ${(e as Error).message}`);
      setStatus(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="配对网关"
      style={{ border: '1px solid #ccc', padding: 16, background: '#fff' }}
    >
      <h3>网关配对</h3>
      <label>
        Gateway URL
        <input
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          aria-label="Gateway URL"
        />
      </label>
      <label>
        Pair Key (可选)
        <input
          type="password"
          value={pairKey}
          onChange={e => setPairKey(e.target.value)}
          aria-label="Pair Key (可选)"
        />
      </label>
      <label>
        客户端名 (可选)
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          aria-label="客户端名"
        />
      </label>
      <button type="button" onClick={submit}>
        提交
      </button>
      <button type="button" onClick={onClose}>
        取消
      </button>
      {status && <p>{status}</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
