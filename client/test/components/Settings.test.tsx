// Settings 面板组件测试：覆盖 URL 输入、测试按钮、4 种状态下的文案与 version 展示。
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Settings } from '@/components/Settings.js';
import type { HandshakeStatus } from '@/compat/handshake.js';

describe('Settings', () => {
  const baseProps = {
    url: 'http://gateway.test',
    onUrlChange: vi.fn(),
    onTest: vi.fn(),
    status: 'PAIRING' as HandshakeStatus,
    version: null,
  };

  it('渲染输入框、按钮、状态指示器', () => {
    render(<Settings {...baseProps} />);
    expect(screen.getByRole('textbox')).toHaveValue('http://gateway.test');
    expect(screen.getByRole('button', { name: /测试/ })).toBeInTheDocument();
  });

  it('改输入框触发 onUrlChange', () => {
    const onUrlChange = vi.fn();
    render(<Settings {...baseProps} onUrlChange={onUrlChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'http://new' } });
    expect(onUrlChange).toHaveBeenCalledWith('http://new');
  });

  it('点测试按钮触发 onTest', () => {
    const onTest = vi.fn();
    render(<Settings {...baseProps} onTest={onTest} />);
    fireEvent.click(screen.getByRole('button', { name: /测试/ }));
    expect(onTest).toHaveBeenCalledTimes(1);
  });

  it('HEALTHY 状态显示 "配对成功"', () => {
    render(<Settings {...baseProps} status="HEALTHY" version="0.0.2" />);
    expect(screen.getByText(/配对成功/)).toBeInTheDocument();
    expect(screen.getByText(/v0\.0\.2/)).toBeInTheDocument();
  });

  it('MISMATCH 状态显示 "版本不匹配"', () => {
    render(<Settings {...baseProps} status="MISMATCH" version="1.5.0" />);
    expect(screen.getByText(/版本不匹配/)).toBeInTheDocument();
    expect(screen.getByText(/v1\.5\.0/)).toBeInTheDocument();
  });

  it('PAIR_FAILED 状态显示 "连接失败"', () => {
    render(<Settings {...baseProps} status="PAIR_FAILED" />);
    expect(screen.getByText(/连接失败/)).toBeInTheDocument();
  });

  it('PAIRING 状态显示 "正在测试"', () => {
    render(<Settings {...baseProps} status="PAIRING" />);
    expect(screen.getByText(/正在测试/)).toBeInTheDocument();
  });
});
