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
  onPaired: (info: {
    clientKey: string;
    name: string | null;
    gatewayUrl: string;
    pairKey: string | null;
  }) => void;
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
  // 浏览器 fetch 失败的几种文本（不同内核不同）：
  //   - "Failed to fetch"   Chromium / Firefox（最常见）
  //   - "Load failed"        Safari / iOS WebView / Tauri macOS WebView
  //   - "NetworkError"       旧 Firefox
  // 都归到"网络连不上"提示。
  if (
    msg === 'Failed to fetch' ||
    msg === 'Load failed' ||
    msg === 'NetworkError' ||
    msg === 'Network request failed'
  ) {
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

// 复制文本到剪贴板，1.5s 内反馈 'copied' 后回 'idle'。
// 失败（旧浏览器 / 无 clipboard 权限）静默忽略，按钮回 'idle'，用户可手动选复制。
async function copyCmd(text: string, setCopied: (s: 'idle' | 'copied') => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    setCopied('copied');
    setTimeout(() => setCopied('idle'), 1500);
  } catch {
    // ignore：用户可手动选中文本复制
  }
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
  // 复制命令按钮的反馈：默认 'idle'，点击后短暂变 'copied' 后回 'idle'。
  const [copied, setCopied] = useState<'idle' | 'copied'>('idle');

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
      onPaired({
        clientKey: data.clientKey,
        name: data.name,
        gatewayUrl: url,
        pairKey: pairKey || null,
      });
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
              onPaired({
                clientKey,
                name: name || null,
                gatewayUrl: url,
                pairKey: pairKey || null,
              });
            }
          } catch (e) {
            // 404 token_not_found = CLI 调 /internal/pair/resolve 已 commit 并把
            // pairing_code 从表里删了。视为配对完成，停止轮询。
            // 5xx / 网络抖动：忽略，按下一次 interval 继续。
            if (e instanceof ApiError && e.code === 404) {
              stopped = true;
              // 网关端已 commit = 用户已配对。saveSecureConfig 在 vite dev 浏览器（无
              // Tauri runtime）里 Stronghold.load 会抛错，但绝不能让存盘失败
              // 阻塞配对成功的状态切换。try/catch 兜住，错误打到 console 即可。
              try {
                await saveSecureConfig({
                  clientKey,
                  gatewayUrl: url,
                  pairKey: pairKey || null,
                  clientName: name || null,
                });
              } catch (saveErr) {
                console.warn('saveSecureConfig failed (production 应不发生):', saveErr);
              }
              onPaired({
                clientKey,
                name: name || null,
                gatewayUrl: url,
                pairKey: pairKey || null,
              });
            }
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
              {/* 完整命令：用户单看 token 不知道该输入啥。直接给到可复制的命令行。 */}
              <div className="cmd-row">
                <code className="cmd-line">my-ai-gateway pair --token {token}</code>
                <button
                  type="button"
                  className="btn-copy"
                  onClick={() => {
                    void copyCmd(`my-ai-gateway pair --token ${token}`, setCopied);
                  }}
                >
                  {copied === 'copied' ? '已复制' : '复制'}
                </button>
              </div>
              <p className="cmd-hint">
                源码 dev 模式：<code>pnpm --filter @my-ai/gateway run pair -- --token {token}</code>
              </p>
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
