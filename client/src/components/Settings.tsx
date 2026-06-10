// Gateway 配对面板：URL 输入 + 测试按钮 + 状态指示器。
// 纯展示组件，所有状态都由父组件（App.tsx）持有与调度。
// v5: 全文案走 i18n；STATUS_LABEL 从 module-level Record 改运行时 t() 调用。
// 文案 / aria-label 保持向后兼容（被 Settings.test.tsx 断言）。
import { useTranslation } from 'react-i18next';
import type { HandshakeStatus } from '../compat/handshake.js';

type Props = {
  url: string;
  onUrlChange: (next: string) => void;
  onTest: () => void;
  status: HandshakeStatus;
  version: string | null;
};

const STATUS_OK: Record<HandshakeStatus, 'true' | 'false' | 'warn' | 'pending'> = {
  PAIRING: 'pending',
  HEALTHY: 'true',
  MISMATCH: 'warn',
  PAIR_FAILED: 'false',
};

export function Settings({ url, onUrlChange, onTest, status, version }: Props) {
  const { t } = useTranslation();
  // 仅在拿得到 version 的两种状态下追加 gateway 版本号。
  const showVersion = (status === 'HEALTHY' || status === 'MISMATCH') && version;
  return (
    <section className="panel" aria-label={t('settings.label')}>
      <header className="panel-head">
        <span>{t('settings.statusHead')}</span>
        <span className="panel-num">02</span>
      </header>
      <div className="panel-body">
        <div className="panel-status">
          <span className="dot" data-ok={STATUS_OK[status]} aria-hidden="true" />
          <span className="status-label">{t('settings.gatewayLabel')}</span>
          <span className="status-value" data-ok={STATUS_OK[status]}>
            {t(`settings.status.${status}`)}
          </span>
        </div>
        {showVersion ? (
          <span className="status-version">
            {t('settings.versionPrefix')} <code>v{version}</code>
          </span>
        ) : null}
        <div className="url-row">
          <input
            type="text"
            className="input"
            value={url}
            onChange={e => onUrlChange(e.target.value)}
            placeholder="http://gateway-host:8787"
            aria-label={t('settings.urlAria')}
          />
          <button type="button" className="btn" onClick={onTest}>
            {t('settings.test')}
          </button>
        </div>
      </div>
    </section>
  );
}
