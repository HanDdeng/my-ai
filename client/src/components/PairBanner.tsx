// 顶部 banner：显示未配对 / 需重新配对 状态 + 提供两个按钮。
// PAIRED / PAIR_PENDING 等其他状态不渲染。
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
  const message =
    variant === 'NEED_PAIR'
      ? '尚未配对。请先完成网关配对。'
      : '上次的 clientKey 已失效，请重新配对。';
  return (
    <div role="alert" style={{ background: '#fff3cd', padding: 12, marginBottom: 8 }}>
      <span>{message}</span>
      <button type="button" onClick={onGoToPair} style={{ marginLeft: 8 }}>
        去配对
      </button>
      <button type="button" onClick={onClear} style={{ marginLeft: 8 }}>
        清除配对
      </button>
    </div>
  );
}
