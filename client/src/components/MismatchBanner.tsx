// Mismatch 警告横幅。
// 关闭由父组件的 bannerDismissed state 控制；本组件只负责渲染 + 触发 onDismiss。
type Props = {
  gatewayVersion: string | null;
  requiredRange: string;
  onDismiss: () => void;
};

export function MismatchBanner({ gatewayVersion, requiredRange, onDismiss }: Props) {
  return (
    <div role="alert" className="mismatch-banner">
      <span>
        ⚠️ Gateway
        {gatewayVersion ? ` v${gatewayVersion}` : ''} 超出 client 兼容范围 ({requiredRange})。
        部分功能可能不可用，建议升级 gateway。
      </span>
      <button type="button" onClick={onDismiss}>
        关闭
      </button>
    </div>
  );
}
