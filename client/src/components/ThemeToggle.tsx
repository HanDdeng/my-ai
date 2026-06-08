// 主题切换按钮：在 light / dark 之间切换。
// - 初始主题：localStorage > prefers-color-scheme > light
// - 主题写入 :root[data-theme]，CSS 变量随之响应
// - 文案显示"当前模式 / 切到另一模式"
import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'my-ai:theme';
const DEFAULT_THEME: Theme = 'light';

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') {
    return DEFAULT_THEME;
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    // localStorage 可能被禁用（隐私模式 / SSR），降级到 prefers-color-scheme
  }
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return DEFAULT_THEME;
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function ThemeToggle() {
  // 初始用函数避免每次 render 读 localStorage。
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  // 主题变化时同步到 DOM + 持久化。
  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // 忽略
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const next = theme === 'dark' ? 'LIGHT' : 'DARK';
  return (
    <button
      type="button"
      className="theme-toggle"
      data-current={theme}
      onClick={toggle}
      aria-label={`当前 ${theme === 'dark' ? '暗' : '亮'}色主题，点击切换到 ${theme === 'dark' ? '亮' : '暗'}色`}
      title={`主题 · ${theme} → ${theme === 'dark' ? 'light' : 'dark'}`}
    >
      <span className="dot" aria-hidden="true" />
      <span>{next}</span>
    </button>
  );
}
