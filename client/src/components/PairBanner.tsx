// 顶部 banner：显示未配对 / 需重新配对 状态 + 提供两个按钮。
// PAIRED / PAIR_PENDING 等其他状态不渲染。
// v5: 全文案走 i18n。
import { useTranslation } from 'react-i18next';

type Variant = 'NEED_PAIR' | 'NEED_REPAIR' | 'PAIRED';

type Props = {
  variant: Variant;
  onGoToPair: () => void;
  onClear: () => void;
};

export function PairBanner({ variant, onGoToPair, onClear }: Props) {
  const { t } = useTranslation();
  if (variant === 'PAIRED') {
    return null;
  }
  const isRepair = variant === 'NEED_REPAIR';
  // kicker / message 来自 i18n；不同 variant 用不同 namespace
  const ns = isRepair ? 'pair.banner.needRepair' : 'pair.banner.needPair';
  const num = isRepair ? '01' : '00';
  return (
    <div role="alert" className={isRepair ? 'banner banner--need-repair' : 'banner'}>
      <span className="banner-num" aria-hidden="true">
        {num}
      </span>
      <span className="banner-text">
        <strong>{t(`${ns}.kicker`)}</strong>
        {t(`${ns}.message`)}
      </span>
      <span className="banner-actions">
        <button type="button" className="btn btn--primary" onClick={onGoToPair}>
          {t('pair.banner.actions.goPair')}
        </button>
        <button type="button" className="btn" onClick={onClear}>
          {t('pair.banner.actions.clear')}
        </button>
      </span>
    </div>
  );
}
