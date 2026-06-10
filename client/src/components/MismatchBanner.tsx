// Mismatch 警告横幅。
// 关闭由父组件的 bannerDismissed state 控制；本组件只负责渲染 + 触发 onDismiss。
// v5: 全文案走 i18n。
import { useTranslation } from 'react-i18next';

type Props = {
  gatewayVersion: string | null;
  requiredRange: string;
  onDismiss: () => void;
};

export function MismatchBanner({ gatewayVersion, requiredRange, onDismiss }: Props) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="mismatch-banner">
      <span>
        <span className="tag">{t('mismatch.tag')}</span>
        {t('mismatch.message', {
          version: gatewayVersion ? `v${gatewayVersion}` : '',
          range: requiredRange,
        })}
      </span>
      <button type="button" className="btn" onClick={onDismiss}>
        {t('mismatch.dismiss')}
      </button>
    </div>
  );
}
