import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MismatchBanner } from '@/components/MismatchBanner.js';

describe('MismatchBanner', () => {
  it('渲染完整提示文案', () => {
    render(
      <MismatchBanner gatewayVersion="1.5.0" requiredRange=">=0.0.2 <0.1.0" onDismiss={vi.fn()} />,
    );
    expect(screen.getByText(/1\.5\.0/)).toBeInTheDocument();
    expect(screen.getByText(/>=0\.0\.2 <0\.1\.0/)).toBeInTheDocument();
  });

  it('点关闭按钮调用 onDismiss', () => {
    const onDismiss = vi.fn();
    render(
      <MismatchBanner
        gatewayVersion="1.5.0"
        requiredRange=">=0.0.2 <0.1.0"
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /关闭/ }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('version 为 null 时不显示具体版本号', () => {
    render(
      <MismatchBanner gatewayVersion={null} requiredRange=">=0.0.2 <0.1.0" onDismiss={vi.fn()} />,
    );
    // 不应该有 "vnull" 这种文案
    expect(screen.queryByText(/null/)).toBeNull();
  });
});
