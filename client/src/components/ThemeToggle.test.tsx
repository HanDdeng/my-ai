// ThemeToggle 组件测试：覆盖初始 + 点击切换 + 持久化 + DOM 同步。
// jsdom 不支持 matchMedia，stub 掉。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { ThemeToggle } from './ThemeToggle.js';

describe('<ThemeToggle>', () => {
  const STORAGE_KEY = 'my-ai:theme';

  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: false, addListener: () => {}, removeListener: () => {} }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('初次渲染：写一个主题到 :root 并持久化', () => {
    render(<ThemeToggle />);
    const setAttr = document.documentElement.getAttribute('data-theme');
    expect(setAttr === 'light' || setAttr === 'dark').toBe(true);
    const stored = window.localStorage.getItem(STORAGE_KEY);
    expect(stored === 'light' || stored === 'dark').toBe(true);
  });

  it('点击 → 切换 :root[data-theme] + localStorage', () => {
    window.localStorage.setItem(STORAGE_KEY, 'light');
    render(<ThemeToggle />);
    const btn = screen.getByRole('button');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    act(() => {
      fireEvent.click(btn);
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('dark');

    act(() => {
      fireEvent.click(btn);
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('light');
  });

  it('初始 localStorage 已有值 → 使用该值', () => {
    window.localStorage.setItem(STORAGE_KEY, 'dark');
    render(<ThemeToggle />);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
