// 顶部 banner：显示未配对 / 需重新配对 状态 + 提供两个按钮。
// PAIRED / PAIR_PENDING 等其他状态不渲染。
// 文案 / aria-label 保持向后兼容（被 PairBanner.test.tsx 断言）。
type Variant = 'NEED_PAIR' | 'NEED_REPAIR' | 'PAIRED';

type Props = {
  variant: Variant;
  onGoToPair: () => void;
  onClear: () => void;
};

export function PairBanner({ variant, onGoToPair, onClear }: Props) {
  if (variant === 'PAIRED') {
    return null;
  }
  const isRepair = variant === 'NEED_REPAIR';
  // kicker / message 分工：测试断言用 getByText 严格匹配单元素，
  // 因此 /未配对/ 只能命中 message，/重新配对/ 只能命中 kicker。
  const kicker = isRepair ? '⚠ 重新配对' : '待配对';
  const message = isRepair
    ? '上次的 clientKey 已失效，请发起新的配对请求。'
    : '尚未配对。请先完成网关配对。';
  const num = isRepair ? '01' : '00';
  return (
    <div role="alert" className={isRepair ? 'banner banner--need-repair' : 'banner'}>
      <span className="banner-num" aria-hidden="true">
        {num}
      </span>
      <span className="banner-text">
        <strong>{kicker}</strong>
        {message}
      </span>
      <span className="banner-actions">
        <button type="button" className="btn btn--primary" onClick={onGoToPair}>
          去配对
        </button>
        <button type="button" className="btn" onClick={onClear}>
          清除配对
        </button>
      </span>
    </div>
  );
}
