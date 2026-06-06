// 客户端根组件：状态机 + heartbeat + 配对面板 + Mismatch banner。
// 状态机：PAIRING → HEALTHY / MISMATCH / PAIR_FAILED。
// 5 min heartbeat 重检；banner 关闭 session 内 sticky。
import { useEffect, useState } from 'react';
import { handshake, type HandshakeStatus } from './compat/handshake.js';
import { COMPAT } from './compat.generated.js';
import { Settings } from './components/Settings.js';
import { MismatchBanner } from './components/MismatchBanner.js';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://127.0.0.1:8787';
// 测试时可通过 import.meta.env 覆盖；缺省 5 min
const HEARTBEAT_MS = Number(import.meta.env.VITE_HEARTBEAT_INTERVAL_MS ?? 5 * 60 * 1000);

function App() {
  const [status, setStatus] = useState<HandshakeStatus>('PAIRING');
  const [version, setVersion] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // 启动 + heartbeat
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      // heartbeat 失败时**不**把 HEALTHY 变 PAIR_FAILED（避免抖动）
      const prev = status;
      const next = await handshake(GATEWAY_URL, COMPAT);
      if (cancelled) {
        return;
      }
      if (next.status === 'PAIR_FAILED' && (prev === 'HEALTHY' || prev === 'MISMATCH')) {
        return; // 静默保留
      }
      setStatus(next.status);
      if (next.version) {
        setVersion(next.version);
      }
    };
    void run();
    const id = setInterval(run, HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTest = async () => {
    setStatus('PAIRING');
    const next = await handshake(GATEWAY_URL, COMPAT);
    setStatus(next.status);
    if (next.version) {
      setVersion(next.version);
    }
    // 不重置 bannerDismissed：用户已"知晓 mismatch"的意图不应被 retry 重置
  };

  return (
    <main className="app">
      <h1>my-ai client</h1>
      <Settings
        url={GATEWAY_URL}
        onUrlChange={() => {
          /* URL 暂不持久化，v3+ 接入 tauri-plugin-store */
        }}
        onTest={handleTest}
        status={status}
        version={version}
      />
      {status === 'MISMATCH' && !bannerDismissed && (
        <MismatchBanner
          gatewayVersion={version}
          requiredRange={COMPAT.upstream.gateway}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}
    </main>
  );
}

export default App;
