// App 根组件测试：状态机 + heartbeat + banner 关闭语义 + 配对流程。
// mock 响应走 v3 新格式：{ data: {ok, service, version, schema}, code, message }
// secure-store 用 mock 模拟"已配对"/"未配对"两种启动条件。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// vi.mock 会被 hoisted，工厂里用到的引用必须用 vi.hoisted。
const { mockLoad, mockClear } = vi.hoisted(() => ({
  mockLoad: vi.fn(),
  mockClear: vi.fn(),
}));

vi.mock('./lib/secure-store.js', () => ({
  loadSecureConfig: mockLoad,
  clearSecureConfig: mockClear,
}));

import App from './App.js';

const GATEWAY_URL = 'http://gateway.test';

// 新格式下的成功响应构造器
function mockOk(version: string) {
  return new Response(
    JSON.stringify({
      data: { ok: true, service: 'gateway', version, schema: 1 },
      code: 0,
      message: 'ok',
    }),
    { status: 200 },
  );
}

// 默认 secureConfig：模拟已配对的客户端，跳过 NEED_PAIR。
function defaultConfig() {
  return {
    clientKey: 'k-test',
    gatewayUrl: GATEWAY_URL,
    pairKey: null,
    clientName: 'tester',
  };
}

describe('App 状态机', () => {
  beforeEach(() => {
    // 只 fake setInterval，让 heartbeat 可被 advanceTimersByTime 推进；
    // setTimeout 保持真实，这样 testing-library 的 findByText / waitFor 轮询能正常触发。
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    // 注入默认 fetch mock：成功 + version 在范围内
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockOk('0.0.2')),
    );
    // 注入 import.meta.env
    vi.stubEnv('VITE_GATEWAY_URL', GATEWAY_URL);
    // 默认 secure-store 返回有效 config（多数 case 假设已配对）。
    mockLoad.mockReset();
    mockClear.mockReset();
    mockLoad.mockResolvedValue(defaultConfig());
    mockClear.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('初始 render → Settings 可见', async () => {
    render(<App />);
    // Settings 的 URL 输入框始终存在；初始 status=PAIRING，Settings 显示"正在测试…"。
    expect(screen.getByLabelText('Gateway URL')).toBeInTheDocument();
    // flush loadSecureConfig promise，避免 act 警告。
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
  });

  it('fetch 成功 + version in range → PAIRED 状态（Settings 显示"配对成功"）', async () => {
    render(<App />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(await screen.findByText(/配对成功/)).toBeInTheDocument();
  });

  it('fetch 成功 + version out of range → PAIRED + MismatchBanner 显示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockOk('1.0.0')),
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
      vi.fn(async () => mockOk('1.0.0')),
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

  it('fetch throw → NEED_REPAIR（Settings 显示"连接失败" + PairBanner 显示）', async () => {
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
    // NEED_REPAIR 同时点亮 PairBanner，文案含"重新配对"。
    expect(screen.getByText(/重新配对/)).toBeInTheDocument();
  });

  it('secure-store 无 config → 直接 NEED_PAIR + PairBanner 显示"尚未配对"', async () => {
    mockLoad.mockResolvedValueOnce(null);
    render(<App />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(await screen.findByText(/尚未配对/)).toBeInTheDocument();
  });

  it('PairBanner 点"去配对"按钮 → PairDialog 弹出', async () => {
    mockLoad.mockResolvedValueOnce(null);
    render(<App />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    fireEvent.click(await screen.findByRole('button', { name: '去配对' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('window 派发 my-ai:unauthorized → 进入 NEED_REPAIR 并弹 PairDialog', async () => {
    render(<App />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    // 先确认 PAIRED
    expect(await screen.findByText(/配对成功/)).toBeInTheDocument();
    // 模拟业务 401 派发
    await act(async () => {
      window.dispatchEvent(new CustomEvent('my-ai:unauthorized'));
    });
    expect(await screen.findByText(/重新配对/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
