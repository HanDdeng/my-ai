// 主题切换按钮（v5）：明 ↔ 暗。点轮换 + localStorage 持久化。
// v5: 全文案走 i18n（aria-label 含 state/next 插值）。
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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

  const isDark = theme === 'dark';
  const stateLabel = isDark ? t('theme.dark') : t('theme.light');
  const nextLabel = isDark ? t('theme.light') : t('theme.dark');
  const nextValue: Theme = isDark ? 'light' : 'dark';

  return (
    <button
      type="button"
      className="theme-toggle"
      data-current={theme}
      onClick={toggle}
      aria-label={t('theme.ariaCurrent', { state: stateLabel, next: nextLabel })}
      title={`${stateLabel} → ${nextValue}`}
    >
      <span className="dot" aria-hidden="true" />
      <span>{nextLabel}</span>
    </button>
  );
}
