// 通用确认弹窗：420px 居中；走 slideInRight / slideOutRight 动画。
// 嵌在 AgentFormDialog 内部时调用处传 { mountEsc: false }，由父层统一响应 ESC。
// 提交流程：点确认 → onConfirm() 由父组件负责实际 API 调用；ConfirmDialog 自身不 catch。
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialogAnimation, type UseDialogAnimationOptions } from '@/lib/use-dialog-animation.js';

export type ConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  options?: UseDialogAnimationOptions;
};

export function ConfirmDialog(props: ConfirmDialogProps): ReactElement {
  const { t } = useTranslation();
  const { title, message, confirmLabel, cancelLabel, onConfirm, onClose, options } = props;
  const { isClosing, close, onOverlayClick } = useDialogAnimation(onClose, options);

  return (
    <>
      <div
        className={`dialog-overlay ${isClosing ? 'is-closing' : ''}`}
        onClick={onOverlayClick}
        role="presentation"
      />
      <div
        className={`dialog-centered ${isClosing ? 'is-closing' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-msg"
      >
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <h2 id="confirm-title" style={{ margin: 0, fontSize: 16 }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label={t('common.close')}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 18,
            }}
          >
            ×
          </button>
        </header>
        <p id="confirm-msg" style={{ margin: '0 0 20px', color: 'var(--text-muted)' }}>
          {message}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={close}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn"
            onClick={onConfirm}
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
