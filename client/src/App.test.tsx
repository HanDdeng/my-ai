// App 根组件测试：状态机 + heartbeat + banner 关闭语义。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import App from './App.js';

const GATEWAY_URL = 'http://gateway.test';

describe('App 状态机', () => {
  beforeEach(() => {
    // 只 fake setInterval，让 heartbeat 可被 advanceTimersByTime 推进；
    // setTimeout 保持真实，这样 testing-library 的 findByText / waitFor 轮询能正常触发。
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    // 注入默认 fetch mock：成功 + version 在范围内
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: true, service: 'gateway', version: '2.0.0', schema: 1 }),
            { status: 200 },
          ),
      ),
    );
    // 注入 import.meta.env
    vi.stubEnv('VITE_GATEWAY_URL', GATEWAY_URL);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('初始 render → Settings 可见', () => {
    render(<App />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('fetch 成功 + version in range → HEALTHY 状态', async () => {
    render(<App />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(await screen.findByText(/配对成功/)).toBeInTheDocument();
  });

  it('fetch 成功 + version out of range → MISMATCH + banner 显示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: true, service: 'gateway', version: '1.0.0', schema: 1 }),
            { status: 200 },
          ),
      ),
    );
    render(<App />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(await screen.findByText(/版本不匹配/)).toBeInTheDocument();
    expect(screen.getByText(/Gateway v1\.0\.0 超出/)).toBeInTheDocument();
  });

  it('点 banner 关闭按钮 → banner 消失，session 内不重亮', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: true, service: 'gateway', version: '1.0.0', schema: 1 }),
            { status: 200 },
          ),
      ),
    );
    render(<App />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    fireEvent.click(screen.getByRole('button', { name: /关闭/ }));
    expect(screen.queryByText(/Gateway v1\.0\.0 超出/)).toBeNull();

    // 推进 5 min fake timer + 触发 heartbeat
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });
    // banner 仍不显示
    expect(screen.queryByText(/Gateway v1\.0\.0 超出/)).toBeNull();
  });

  it('fetch throw → PAIR_FAILED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('net');
      }),
    );
    render(<App />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(await screen.findByText(/连接失败/)).toBeInTheDocument();
  });
});
