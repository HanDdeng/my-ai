// EmptyOffice 组件测试：渲染图标 + 文案 + CTA 按钮。
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyOffice } from '@/components/EmptyOffice.js';

describe('<EmptyOffice>', () => {
  it('渲染标题 / 消息 / CTA 按钮', () => {
    render(<EmptyOffice onCreate={vi.fn()} />);
    expect(screen.getByText('尚无 agent')).toBeInTheDocument();
    expect(screen.getByText('请新建一个开始')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建 agent' })).toBeInTheDocument();
  });

  it('点 CTA → onCreate', () => {
    const onCreate = vi.fn();
    render(<EmptyOffice onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: '新建 agent' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});
