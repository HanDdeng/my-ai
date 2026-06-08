// 配对弹出层：表单 + 提交 → GET /health 检查连通 → POST /pair → 成功/轮询。
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

// 配对等待中的状态文案（timeout 判定 + 用户可见，单独提取出来保持一致）。
const STATUS_PENDING = '等待对方确认…';

// 网络层错误（fetch 失败 / JSON 解析失败）→ 普通用户能看懂的提示。
// 原 e.message（"Failed to fetch" / "invalid JSON response from ..."）全是英文，
// 非专业用户读了不知道是啥。
// 任何路径都不能让 undefined / null 漏到 UI。
function friendlyNetworkError(e: unknown, prefix: string): string {
  const raw = e instanceof Error ? e.message : String(e);
  const msg = raw && raw !== 'undefined' && raw !== 'null' ? raw : '';
  if (msg === 'Failed to fetch') {
    return `${prefix}：网络连不上，请检查 URL / 端口 / 防火墙`;
  }
  if (msg.startsWith('invalid JSON response')) {
    return `${prefix}：目标地址返回的不是 my-ai 网关响应（确认端口/URL 没指错）`;
  }
  if (msg) {
    return `${prefix}：${msg}`;
  }
  return `${prefix}：网络异常（未知错误）`;
}

// 网关业务码 → 普通用户能看懂的提示。code 来自 gateway/src/response.ts err()。
// 未列出的 code 用 message 兜底（message 为空时显示错误码，绝不漏 undefined）。
function friendlyApiError(e: unknown, prefix: string): string {
  if (!(e instanceof ApiError)) {
    return friendlyNetworkError(e, prefix);
  }
  const map: Record<number, string> = {
    400: '请求格式有误',
    401: '客户端标识无效或缺失',
    403: '无权限访问',
    404: '资源不存在（确认码可能已过期）',
    500: '网关内部错误',
    502: '上游服务不可用',
  };
  const zh = map[e.code];
  if (zh) {
    return `${prefix}：${zh}`;
  }
  // 兜底：message 可能为 undefined（网关漏字段）或空字符串
  const raw = (e.message ?? '').toString();
  if (raw && raw !== 'undefined' && raw !== 'null') {
    return `${prefix}：${raw}`;
  }
  return `${prefix}：错误码 ${e.code}`;
}

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
    setStatus('正在连接网关…');
    setStatusState('idle');
    try {
      await apiFetch(`${url}/health`, { clientKey });
    } catch (e) {
      setError(friendlyNetworkError(e, '连不上网关'));
      setStatus(null);
      return;
    }
    setStatus('正在配对…');
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
          setError('配对失败：网关响应缺少确认码');
          setStatus(null);
          return;
        }
        setToken(tk);
        setStatus(STATUS_PENDING);
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
          if (status === STATUS_PENDING) {
            setError('对方长时间未确认（5 分钟），请重试或联系管理员');
            setStatus(null);
            setStatusState('idle');
          }
        }, POLL_TIMEOUT_MS);
        void poll();
        return;
      }
      setError(friendlyApiError(e, '配对失败'));
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
                <span>配对确认码</span>
                <span>在网关所在主机终端运行 ↓</span>
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
