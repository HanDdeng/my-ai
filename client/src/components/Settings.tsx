// Gateway 配对面板：URL 输入 + 测试按钮 + 状态指示器。
// 纯展示组件，所有状态都由父组件（App.tsx）持有与调度。
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

export function Settings({ url, onUrlChange, onTest, status, version }: Props) {
  // 仅在拿得到 version 的两种状态下追加 gateway 版本号。
  const showVersion = (status === 'HEALTHY' || status === 'MISMATCH') && version;
  return (
    <section>
      <h3>Gateway</h3>
      <input
        type="text"
        value={url}
        onChange={e => onUrlChange(e.target.value)}
        placeholder="http://gateway-host:8787"
        aria-label="Gateway URL"
      />
      <button type="button" onClick={onTest}>
        测试
      </button>
      <p>
        {STATUS_LABEL[status]}
        {showVersion ? ` · gateway v${version}` : ''}
      </p>
    </section>
  );
}
