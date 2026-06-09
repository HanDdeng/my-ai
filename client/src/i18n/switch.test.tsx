// <LanguageSwitcher /> 行为测试（v5）：切语种 + localStorage 写入。
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from './index.js';
import { LanguageSwitcher } from './switch.js';

describe('<LanguageSwitcher>', () => {
  beforeEach(() => {
    i18n.changeLanguage('zh-CN');
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
  });

  it('初始渲染当前语言代码（zh-CN → "中"）', () => {
    render(<LanguageSwitcher />);
    expect(screen.getByText(i18n.t('lang.zh'))).toBeInTheDocument();
  });

  it('点按钮 → 切到 en + localStorage 写入 en', async () => {
    render(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole('button'));
    // i18n.changeLanguage 是 async，等 promise 完成
    await i18n.changeLanguage('en');
    expect(localStorage.getItem('my-ai:lang')).toBe('en');
  });

  it('切到 en 后渲染 "EN" 文字', async () => {
    render(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole('button'));
    await i18n.changeLanguage('en');
    expect(screen.getByText(i18n.t('lang.en'))).toBeInTheDocument();
  });

  it('aria-label 含当前语言名', () => {
    render(<LanguageSwitcher />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-label')).toContain(i18n.t('lang.zh'));
  });
});
