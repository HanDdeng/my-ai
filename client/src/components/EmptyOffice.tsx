// 虚拟办公室空状态：DB 无 agent 时显示。
// 图标 + 文案 + 主 CTA 按钮。
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

export type EmptyOfficeProps = {
  onCreate: () => void;
};

export function EmptyOffice({ onCreate }: EmptyOfficeProps): ReactElement {
  const { t } = useTranslation();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 200,
        padding: 32,
        color: 'var(--text-muted)',
      }}
      role="status"
    >
      <svg
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="9" y1="9" x2="15" y2="9" />
        <line x1="9" y1="13" x2="15" y2="13" />
        <line x1="9" y1="17" x2="13" y2="17" />
      </svg>
      <h2 style={{ margin: '16px 0 4px', fontSize: 18, color: 'var(--text)' }}>
        {t('emptyOffice.title')}
      </h2>
      <p style={{ margin: '0 0 16px' }}>{t('emptyOffice.message')}</p>
      <button type="button" className="btn" onClick={onCreate}>
        {t('emptyOffice.cta')}
      </button>
    </div>
  );
}
