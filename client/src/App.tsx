// 客户端根组件（v3）：状态机 + 配对 banner/dialog + 业务 401 被动感知。
// 状态机：PAIRING → NEED_PAIR / PAIR_PENDING / PAIRED / NEED_REPAIR / PAIR_FAILED。
// - PAIRING：启动 / 重检握手中
// - NEED_PAIR：首次启动且 secure store 无 config
// - PAIR_PENDING：PairDialog 提交后等待 CLI 解析（由 dialog 自身渲染）
// - PAIRED：握手成功（HEALTHY 或 MISMATCH，版本超范由 MismatchBanner 提示）
// - NEED_REPAIR：握手失败 / 业务 401（clientKey 失效）
// - PAIR_FAILED：网关不可达 / 致命错误（v3 阶段与 NEED_REPAIR 共用 banner 文案）
import { useCallback, useEffect, useState } from 'react';
import { handshake, type HandshakeStatus } from './compat/handshake.js';
import { COMPAT } from './compat.generated.js';
import { Settings } from './components/Settings.js';
import { MismatchBanner } from './components/MismatchBanner.js';
import { PairBanner } from './components/PairBanner.js';
import { PairDialog } from './components/PairDialog.js';
import { ThemeToggle } from './components/ThemeToggle.js';
import { loadSecureConfig, clearSecureConfig, type SecureConfig } from './lib/secure-store.js';
import { randomUUID } from './lib/uuid.js';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://127.0.0.1:8787';
// 测试时可通过 import.meta.env 覆盖；缺省 5 min。
const HEARTBEAT_MS = Number(import.meta.env.VITE_HEARTBEAT_INTERVAL_MS ?? 5 * 60 * 1000);

// App 状态机扩展：NEED_PAIR / PAIR_PENDING / PAIRED / NEED_REPAIR / PAIR_FAILED / PAIRING。
type AppStatus =
  | 'NEED_PAIR'
  | 'PAIR_PENDING'
  | 'PAIRED'
  | 'NEED_REPAIR'
  | 'PAIR_FAILED'
  | 'PAIRING';

// 把 AppStatus 映射回 HandshakeStatus，复用 v2 Settings 组件的文案。
// PAIRED 状态下根据 mismatch 决定是 HEALTHY 还是 MISMATCH。
function toHandshakeStatus(s: AppStatus, mismatch: boolean): HandshakeStatus {
  if (s === 'PAIRED') {
    return mismatch ? 'MISMATCH' : 'HEALTHY';
  }
  if (s === 'PAIRING' || s === 'PAIR_PENDING') {
    return 'PAIRING';
  }
  // NEED_PAIR / NEED_REPAIR / PAIR_FAILED 三态在 Settings 中均显示为"连接失败"。
  return 'PAIR_FAILED';
}

function App() {
  const [status, setStatus] = useState<AppStatus>('PAIRING');
  const [version, setVersion] = useState<string | null>(null);
  // 单独追踪版本是否超出兼容范围（PAIRED 但 MismatchBanner 是否要亮）。
  const [isMismatch, setIsMismatch] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [secureConfig, setSecureConfig] = useState<SecureConfig | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  // 首次配对（无 secureConfig）时为 PairDialog 提供稳定的临时 clientKey。
  // 用 useState 初始化函数确保只生成一次，不随 re-render 抖动。
  const [draftKey, setDraftKey] = useState<string>(() => randomUUID());

  // 启动时读 secure config；无则进入 NEED_PAIR。
  useEffect(() => {
    let cancelled = false;
    void loadSecureConfig()
      .then(cfg => {
        if (cancelled) {
          return;
        }
        if (cfg) {
          setSecureConfig(cfg);
        } else {
          setStatus('NEED_PAIR');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('NEED_PAIR');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 跑一次握手并把结果落到状态机。useCallback([]) 让引用稳定，
  // 既给 heartbeat 用，也给 Settings 的"测试"按钮用。
  const runHandshake = useCallback(async (cfg: SecureConfig) => {
    const next = await handshake(cfg.gatewayUrl, COMPAT, cfg.clientKey);
    if (next.status === 'HEALTHY') {
      setStatus('PAIRED');
      setIsMismatch(false);
      setVersion(next.version);
    } else if (next.status === 'MISMATCH') {
      // version 不在范围但配对 OK，由 MismatchBanner 提示。
      setStatus('PAIRED');
      setIsMismatch(true);
      setVersion(next.version);
    } else if (next.status === 'PAIR_FAILED') {
      // 握手失败：可能是 clientKey 已失效或网络抖动，统一进入 NEED_REPAIR 让用户重试。
      setStatus('NEED_REPAIR');
    }
  }, []);

  // 有 secureConfig 后启动握手 + 5 min heartbeat。
  useEffect(() => {
    if (!secureConfig) {
      return;
    }
    let cancelled = false;
    const run = async () => {
      if (cancelled) {
        return;
      }
      await runHandshake(secureConfig);
    };
    void run();
    const id = setInterval(run, HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [secureConfig, runHandshake]);

  // 业务 401 被动感知：监听全局 my-ai:unauthorized 事件（由 apiFetch 调用方在 401 时派发）。
  // v3 阶段先用 CustomEvent 解耦；后续可换成 React context / store。
  useEffect(() => {
    const onUnauthorized = () => {
      setStatus('NEED_REPAIR');
      setShowDialog(true);
    };
    window.addEventListener('my-ai:unauthorized', onUnauthorized);
    return () => window.removeEventListener('my-ai:unauthorized', onUnauthorized);
  }, []);

  const handlePaired = (info: {
    clientKey: string;
    name: string | null;
    gatewayUrl: string;
    pairKey: string | null;
  }) => {
    // 配对成功：用 dialog 实际提交的 URL / pairKey，更新 clientKey 与名字；
    // setSecureConfig 触发上面的 heartbeat useEffect 重启。
    // 之前用 prev?.gatewayUrl ?? GATEWAY_URL 会让用户填的 10.0.0.4 被丢成
    // 默认的 127.0.0.1，导致 Settings 显示地址与实际不一致、且重连时握手
    // 走错 host。修法：dialog 把 URL 透传过来，优先用它，prev 兜底。
    setSecureConfig(prev => ({
      clientKey: info.clientKey,
      gatewayUrl: info.gatewayUrl || prev?.gatewayUrl || GATEWAY_URL,
      pairKey: info.pairKey ?? prev?.pairKey ?? null,
      clientName: info.name,
    }));
    setStatus('PAIRED');
    setIsMismatch(false);
    setShowDialog(false);
    // 下一次开 dialog 重新生成 draftKey（避免复用已配对的临时 key）。
    setDraftKey(randomUUID());
  };

  const handleClear = async () => {
    await clearSecureConfig();
    setSecureConfig(null);
    setStatus('NEED_PAIR');
    setVersion(null);
    setIsMismatch(false);
    setBannerDismissed(false);
  };

  const settingsStatus = toHandshakeStatus(status, isMismatch);

  // Settings 上的"测试"按钮：已配对则重跑一次握手并先切到 PAIRING 状态
  // 让用户立刻看到"正在测试…"反馈；未配对则打开 PairDialog 引导进入配对流程。
  const handleTest = () => {
    if (secureConfig) {
      setStatus('PAIRING');
      void runHandshake(secureConfig);
    } else {
      setShowDialog(true);
    }
  };

  return (
    <main className="app">
      <header className="app-meta">
        <span className="brand">my-ai</span>
        <ThemeToggle />
      </header>

      <h1 className="app-title">
        GATEWAY <em>PAIR</em>
      </h1>
      <p className="app-sub">
        <span className="num">v3</span>
        <span>REMOTE PAIRING &amp; AUTH</span>
        <span>·</span>
        <span>CLIENT 0.0.3</span>
      </p>

      {(status === 'NEED_PAIR' || status === 'NEED_REPAIR') && (
        <PairBanner
          variant={status}
          onGoToPair={() => setShowDialog(true)}
          onClear={() => {
            void handleClear();
          }}
        />
      )}
      {showDialog && (
        <PairDialog
          initialUrl={secureConfig?.gatewayUrl ?? GATEWAY_URL}
          initialPairKey={secureConfig?.pairKey ?? null}
          initialName={secureConfig?.clientName ?? null}
          clientKey={secureConfig?.clientKey ?? draftKey}
          onPaired={handlePaired}
          onClose={() => setShowDialog(false)}
        />
      )}
      <Settings
        url={secureConfig?.gatewayUrl ?? GATEWAY_URL}
        onUrlChange={() => {
          /* v3 阶段不在 Settings 编辑 URL；由 PairDialog 维护 */
        }}
        onTest={handleTest}
        status={settingsStatus}
        version={version}
      />
      {status === 'PAIRED' && isMismatch && !bannerDismissed && version && (
        <MismatchBanner
          gatewayVersion={version}
          requiredRange={COMPAT.upstream.gateway}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      <footer className="app-foot">
        <span>© my-ai · local control</span>
        <span className="ascii">━━ 2026/06/08</span>
      </footer>
    </main>
  );
}

export default App;
