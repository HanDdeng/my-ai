// PairBanner 组件测试：覆盖显示/隐藏 + 按钮回调。
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PairBanner } from '@/components/PairBanner.js';

describe('<PairBanner>', () => {
  it('未配对状态显示"去配对"和"清除配对"按钮', () => {
    const onPair = vi.fn();
    const onClear = vi.fn();
    render(<PairBanner variant="NEED_PAIR" onGoToPair={onPair} onClear={onClear} />);
    expect(screen.getByText(/未配对/)).toBeTruthy();
    fireEvent.click(screen.getByText('去配对'));
    expect(onPair).toHaveBeenCalled();
    fireEvent.click(screen.getByText('清除配对'));
    expect(onClear).toHaveBeenCalled();
  });

  it('需重新配对状态显示额外提示', () => {
    render(<PairBanner variant="NEED_REPAIR" onGoToPair={() => {}} onClear={() => {}} />);
    expect(screen.getByText(/重新配对/)).toBeTruthy();
  });

  it('已配对状态不渲染', () => {
    const { container } = render(
      <PairBanner variant="PAIRED" onGoToPair={() => {}} onClear={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
