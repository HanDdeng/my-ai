// useDialogAnimation hook 测试：isClosing 状态 + 关闭定时 + ESC 监听 + mountEsc 选项。
// 用 RTL renderHook 跑 7 行为 + 1 边界。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDialogAnimation } from '@/lib/use-dialog-animation.js';

describe('useDialogAnimation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('初始 isClosing=false', () => {
    const { result } = renderHook(() => useDialogAnimation(vi.fn()));
    expect(result.current.isClosing).toBe(false);
  });

  it('调 close() → isClosing=true + 150ms 后 onClose 被调', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useDialogAnimation(onClose));
    act(() => result.current.close());
    expect(result.current.isClosing).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('150ms 内二次调 close() 被忽略（closingRef 守卫）', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useDialogAnimation(onClose));
    act(() => result.current.close());
    act(() => result.current.close()); // 第二次
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ESC 键触发 close()', () => {
    const onClose = vi.fn();
    renderHook(() => useDialogAnimation(onClose));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      vi.advanceTimersByTime(150);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('mountEsc=false 时 ESC 不触发 close', () => {
    const onClose = vi.fn();
    renderHook(() => useDialogAnimation(onClose, { mountEsc: false }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      vi.advanceTimersByTime(150);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('onOverlayClick = close（同一引用）', () => {
    const { result } = renderHook(() => useDialogAnimation(vi.fn()));
    expect(result.current.onOverlayClick).toBe(result.current.close);
  });

  it('卸载时清理未触发的 timer', () => {
    const onClose = vi.fn();
    const { unmount, result } = renderHook(() => useDialogAnimation(onClose));
    act(() => result.current.close());
    unmount();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    // onClose 不应被调（timer 被 clearTimeout）
    expect(onClose).not.toHaveBeenCalled();
  });
});
