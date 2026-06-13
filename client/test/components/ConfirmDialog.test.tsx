// ConfirmDialog 组件测试：标题 / 消息 / 按钮 / ESC 行为。
// 注: useDialogAnimation 的 ESC 行为已在 hook 测试覆盖；这里验证 ConfirmDialog 传 mountEsc=false。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ConfirmDialog } from '@/components/ConfirmDialog.js';

describe('<ConfirmDialog>', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('渲染 title / message / 确认按钮 / 取消按钮', () => {
    render(
      <ConfirmDialog
        title="删除 Agent"
        message="确定删除吗？"
        confirmLabel="删除"
        cancelLabel="取消"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('删除 Agent')).toBeInTheDocument();
    expect(screen.getByText('确定删除吗？')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
  });

  it('点确认 → onConfirm', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="t"
        message="m"
        confirmLabel="c"
        cancelLabel="x"
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'c' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('点取消 → 触发关闭动画 + 150ms 后 onClose', () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        title="t"
        message="m"
        confirmLabel="c"
        cancelLabel="x"
        onConfirm={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'x' }));
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点 × 关闭按钮 → onClose', () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        title="t"
        message="m"
        confirmLabel="c"
        cancelLabel="x"
        onConfirm={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByLabelText('关闭'));
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ESC 键不触发关闭（嵌套场景 options.mountEsc=false）', () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        title="t"
        message="m"
        confirmLabel="c"
        cancelLabel="x"
        onConfirm={vi.fn()}
        onClose={onClose}
        options={{ mountEsc: false }}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ESC 键触发关闭（顶层场景 options.mountEsc 默认 true）', () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        title="t"
        message="m"
        confirmLabel="c"
        cancelLabel="x"
        onConfirm={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
