// 3 个抽屉式弹窗复用：管理 isClosing 状态 + 可选 ESC 键 + 关闭定时。
// 200ms 打开 / 150ms 关闭（CSS 动画时长；同步 timeout 后才调 onClose 真正卸载）。
// mountEsc 默认 true：3 抽屉都挂 ESC；嵌套场景（ConfirmDialog in AgentFormDialog）
//   → ConfirmDialog 传 { mountEsc: false } 避免双 ESC 监听 + 重复触发 close。
import { useCallback, useEffect, useRef, useState } from 'react';

const CLOSE_MS = 150;

export type UseDialogAnimationOptions = {
  mountEsc?: boolean;
};

export type UseDialogAnimation = {
  isClosing: boolean;
  close: () => void;
  onOverlayClick: () => void;
};

export function useDialogAnimation(
  onClose: () => void,
  options: UseDialogAnimationOptions = {},
): UseDialogAnimation {
  const { mountEsc = true } = options;
  const [isClosing, setIsClosing] = useState(false);
  const timerRef = useRef<number | null>(null);
  const closingRef = useRef(false);

  // 卸载时清理未触发的定时器
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [],
  );

  const close = useCallback(() => {
    if (closingRef.current) {
      return;
    } // 二次点击直接忽略
    closingRef.current = true;
    setIsClosing(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      onClose();
    }, CLOSE_MS);
  }, [onClose]);

  // ESC 键监听（嵌套子层可关掉）
  useEffect(() => {
    if (!mountEsc) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mountEsc, close]);

  return { isClosing, close, onOverlayClick: close };
}
