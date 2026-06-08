// 配对弹出层：表单 + 提交 → GET /health 探活 → POST /pair → 成功/轮询。
// v3 阶段简化 UI：3 个 input + 1 个 submit 按钮 + 状态文字。
// 文案 / aria-label / role 保持向后兼容（被 PairDialog.test.tsx 断言）。
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
  const [statusState, setStatusState] = useState<'idle' | 'pending'>('idle');
  const [token, setToken] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setStatus('探活中…');
    setStatusState('idle');
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
        const tk = (e.data as { token?: string } | null)?.token;
        if (!tk) {
          setError('配对失败: 响应缺少 token');
          setStatus(null);
          return;
        }
        setToken(tk);
        setStatus('等待 CLI 解析…');
        setStatusState('pending');
        let stopped = false;
        const poll = async () => {
          if (stopped) {
            return;
          }
          try {
            const r = await apiFetch<{ status: string }>(`${url}/pair/status?token=${tk}`);
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
            setStatusState('idle');
          }
        }, POLL_TIMEOUT_MS);
        void poll();
        return;
      }
      setError(`配对失败: ${(e as Error).message}`);
      setStatus(null);
      setStatusState('idle');
    }
  };

  return (
    <div
      className="dialog-backdrop"
      onClick={e => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div role="dialog" aria-label="配对网关" className="dialog">
        <header className="dialog-head">
          <h2 className="dialog-title">
            配对<em>·</em>网关
          </h2>
          <span className="dialog-sub">PAIRING / STEP 01</span>
        </header>
        <div className="dialog-body">
          <div className="field">
            <label className="field-label" htmlFor="pair-url">
              <span>Gateway URL</span>
              <span className="req">REQ</span>
            </label>
            <input
              id="pair-url"
              className="input"
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              aria-label="Gateway URL"
              placeholder="http://127.0.0.1:8787"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="pair-key">
              <span>Pair Key</span>
              <span>OPT</span>
            </label>
            <input
              id="pair-key"
              className="input"
              type="password"
              value={pairKey}
              onChange={e => setPairKey(e.target.value)}
              aria-label="Pair Key (可选)"
              placeholder="私有模式凭证"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="pair-name">
              <span>客户端名</span>
              <span>OPT</span>
            </label>
            <input
              id="pair-name"
              className="input"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              aria-label="客户端名"
              placeholder="alice-laptop"
              autoComplete="off"
            />
          </div>
          {status && (
            <div className="dialog-status" data-state={statusState} role="status">
              {status}
            </div>
          )}
          {token && (
            <div className="field">
              <span className="field-label">
                <span>Pair Token</span>
                <span>RUN CLI ↓</span>
              </span>
              <code className="token-block">{token}</code>
            </div>
          )}
          {error && (
            <div className="dialog-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <footer className="dialog-foot">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn--signal"
            onClick={() => {
              void submit();
            }}
          >
            提交
          </button>
        </footer>
      </div>
    </div>
  );
}
