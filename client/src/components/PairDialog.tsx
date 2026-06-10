// 配对弹出层：表单 + 提交 → GET /health 检查连通 → POST /pair → 成功/轮询。
// v5: 全文案走 i18n；错误码 map（friendlyApiError 内 Record<number,string>）改为
//     资源文件查表 i18n.t('errors.api.<code>')。
// 文案 / aria-label / role 保持向后兼容（被 PairDialog.test.tsx 断言）。
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { apiFetch, ApiError } from '../lib/api.js';
import { saveSecureConfig } from '../lib/secure-store.js';

// v5: t() 函数签名从 useTranslation() 解构出来比手写 (k: string) => string 更稳：
// 1) 与 i18next 的 TFunction 类型完全一致，避免 exactOptionalPropertyTypes
//    之类的边界类型错配（手写签名只接受 string key，而 TFunction 还能接 string[]）；
// 2) friendlyApiError / friendlyNetworkError 内 t(`errors.api.${code}`) 这种
//    运行时拼 key 的调用，类型系统能继续 narrowing，不报"key 字面量不在资源里"。
type Tx = TFunction<'translation', undefined>;

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

// 网络层错误（fetch 失败 / JSON 解析失败）→ 普通用户能看懂的提示。
// 原 e.message（"Failed to fetch" / "invalid JSON response from ..."）全是英文，
// 非专业用户读了不知道是啥。
// 任何路径都不能让 undefined / null 漏到 UI。
// v5: 文案从字面量改查 i18n key。
function friendlyNetworkError(e: unknown, prefix: string, t: Tx): string {
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
    return `${prefix}：${t('errors.network.fetchFail')}`;
  }
  if (msg.startsWith('invalid JSON response')) {
    return `${prefix}：${t('errors.network.notMyAi')}`;
  }
  if (msg) {
    return `${prefix}：${msg}`;
  }
  return `${prefix}：${t('errors.network.unknown')}`;
}

// 网关业务码 → 普通用户能看懂的提示。code 来自 gateway/src/response.ts err()。
// v5: 文案从字面量 Record 改为查 i18n key；未列出 code 走 defaultValue + 兜底。
function friendlyApiError(e: unknown, prefix: string, t: Tx): string {
  if (!(e instanceof ApiError)) {
    return friendlyNetworkError(e, prefix, t);
  }
  const translated = t(`errors.api.${e.code}`);
  if (translated && translated !== `errors.api.${e.code}`) {
    return `${prefix}：${translated}`;
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
  const { t } = useTranslation();
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
    setStatus(t('pair.dialog.status.connecting'));
    setStatusState('idle');
    try {
      await apiFetch(`${url}/health`, { clientKey });
    } catch (e) {
      setError(friendlyNetworkError(e, t('pair.dialog.errors.network'), t));
      setStatus(null);
      return;
    }
    setStatus(t('pair.dialog.status.pairing'));
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
          setError(t('pair.dialog.errors.missingToken'));
          setStatus(null);
          return;
        }
        setToken(tk);
        setStatus(t('pair.dialog.status.pending'));
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
          if (status === t('pair.dialog.status.pending')) {
            setError(t('pair.dialog.errors.timeout'));
            setStatus(null);
            setStatusState('idle');
          }
        }, POLL_TIMEOUT_MS);
        void poll();
        return;
      }
      setError(friendlyApiError(e, t('pair.dialog.errors.pairFail'), t));
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
      <div role="dialog" aria-label={t('pair.dialog.title')} className="dialog">
        <header className="dialog-head">
          <h2 className="dialog-title">
            {t('pair.dialog.title')}
            <em>·</em>
          </h2>
          <span className="dialog-sub">{t('pair.dialog.sub')}</span>
        </header>
        <div className="dialog-body">
          <div className="field">
            <label className="field-label" htmlFor="pair-url">
              <span>{t('pair.dialog.fields.url.label')}</span>
              <span className="req">{t('pair.dialog.fields.url.req')}</span>
            </label>
            <input
              id="pair-url"
              className="input"
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              aria-label={t('pair.dialog.fields.url.label')}
              placeholder={t('pair.dialog.fields.url.placeholder')}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="pair-key">
              <span>{t('pair.dialog.fields.pairKey.label')}</span>
              <span>{t('pair.dialog.fields.pairKey.opt')}</span>
            </label>
            <input
              id="pair-key"
              className="input"
              type="password"
              value={pairKey}
              onChange={e => setPairKey(e.target.value)}
              aria-label={t('pair.dialog.fields.pairKey.aria')}
              placeholder={t('pair.dialog.fields.pairKey.placeholder')}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="pair-name">
              <span>{t('pair.dialog.fields.name.label')}</span>
              <span>{t('pair.dialog.fields.name.opt')}</span>
            </label>
            <input
              id="pair-name"
              className="input"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              aria-label={t('pair.dialog.fields.name.aria')}
              placeholder={t('pair.dialog.fields.name.placeholder')}
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
                <span>{t('pair.dialog.token.label')}</span>
                <span>{t('pair.dialog.token.hintHead')}</span>
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
                  {copied === 'copied'
                    ? t('pair.dialog.actions.copied')
                    : t('pair.dialog.actions.copy')}
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
            {t('pair.dialog.actions.cancel')}
          </button>
          <button
            type="button"
            className="btn btn--signal"
            onClick={() => {
              void submit();
            }}
          >
            {t('pair.dialog.actions.submit')}
          </button>
        </footer>
      </div>
    </div>
  );
}
