// Gateway 配对面板：URL 输入 + 测试按钮 + 状态指示器。
// 纯展示组件，所有状态都由父组件（App.tsx）持有与调度。
// 文案 / aria-label 保持向后兼容（被 Settings.test.tsx 断言）。
import type { HandshakeStatus } from '../compat/handshake.js';

type Props = {
  url: string;
  onUrlChange: (next: string) => void;
  onTest: () => void;
  status: HandshakeStatus;
  version: string | null;
};

// 4 种握手状态对应中文文案，HEALTHY/MISMATCH 才会带 version。
const STATUS_LABEL: Record<HandshakeStatus, string> = {
  PAIRING: '正在测试…',
  HEALTHY: '配对成功',
  MISMATCH: '版本不匹配',
  PAIR_FAILED: '连接失败',
};

const STATUS_OK: Record<HandshakeStatus, 'true' | 'false' | 'warn' | 'pending'> = {
  PAIRING: 'pending',
  HEALTHY: 'true',
  MISMATCH: 'warn',
  PAIR_FAILED: 'false',
};

export function Settings({ url, onUrlChange, onTest, status, version }: Props) {
  // 仅在拿得到 version 的两种状态下追加 gateway 版本号。
  const showVersion = (status === 'HEALTHY' || status === 'MISMATCH') && version;
  return (
    <section className="panel" aria-label="Gateway 状态">
      <header className="panel-head">
        <span>STATUS / GATEWAY</span>
        <span className="panel-num">02</span>
      </header>
      <div className="panel-body">
        <div className="panel-status">
          <span className="dot" data-ok={STATUS_OK[status]} aria-hidden="true" />
          <span className="status-label">网关</span>
          <span className="status-value" data-ok={STATUS_OK[status]}>
            {STATUS_LABEL[status]}
          </span>
        </div>
        {showVersion ? (
          <span className="status-version">
            GATEWAY <code>v{version}</code>
          </span>
        ) : null}
        <div className="url-row">
          <input
            type="text"
            className="input"
            value={url}
            onChange={e => onUrlChange(e.target.value)}
            placeholder="http://gateway-host:8787"
            aria-label="Gateway URL"
          />
          <button type="button" className="btn" onClick={onTest}>
            测试
          </button>
        </div>
      </div>
    </section>
  );
}
