// PairBanner 组件测试：覆盖显示/隐藏 + 按钮回调。
// v5: 文案断言改用 i18n.t(key)，与译文解耦。
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PairBanner } from '@/components/PairBanner.js';
import i18n from '@/i18n/index.js';

describe('<PairBanner>', () => {
  it('未配对状态显示"去配对"和"清除配对"按钮', () => {
    const onPair = vi.fn();
    const onClear = vi.fn();
    render(<PairBanner variant="NEED_PAIR" onGoToPair={onPair} onClear={onClear} />);
    // NEED_PAIR 时 kicker 为 "待配对"，message 含 "尚未配对"；选 message 做断言。
    expect(screen.getByText(i18n.t('pair.banner.needPair.message'))).toBeInTheDocument();
    fireEvent.click(screen.getByText(i18n.t('pair.banner.actions.goPair')));
    expect(onPair).toHaveBeenCalled();
    fireEvent.click(screen.getByText(i18n.t('pair.banner.actions.clear')));
    expect(onClear).toHaveBeenCalled();
  });

  it('需重新配对状态显示额外提示', () => {
    render(<PairBanner variant="NEED_REPAIR" onGoToPair={() => {}} onClear={() => {}} />);
    // NEED_REPAIR 时 kicker 为 "⚠ 重新配对"，message 为 clientKey 失效提示。
    expect(screen.getByText(i18n.t('pair.banner.needRepair.kicker'))).toBeInTheDocument();
  });

  it('已配对状态不渲染', () => {
    const { container } = render(
      <PairBanner variant="PAIRED" onGoToPair={() => {}} onClear={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
