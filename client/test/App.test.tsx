// App 根组件测试：状态机 + heartbeat + banner 关闭语义 + 配对流程。
// mock 响应走 v3 新格式：{ data: {ok, service, version, schema}, code, message }
// secure-store 用 mock 模拟"已配对"/"未配对"两种启动条件。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import i18n from '@/i18n/index.js';

// vi.mock 会被 hoisted，工厂里用到的引用必须用 vi.hoisted。
const { mockLoad, mockClear } = vi.hoisted(() => ({
  mockLoad: vi.fn(),
  mockClear: vi.fn(),
}));

vi.mock('@/lib/secure-store.js', () => ({
  loadSecureConfig: mockLoad,
  clearSecureConfig: mockClear,
}));

import App from '@/App.js';

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

// v6.3: Office 渲染后会调 listAgents（GET /v1/agents）。App 状态机测试关心的是
// handshake 路径，Office 那条路只关心不要让 fetch 抛错。统一返回空数组
// 让 Office 进入 EmptyOffice 分支。
function mockAgentList() {
  return new Response(
    JSON.stringify({
      data: [],
      code: 0,
      message: 'ok',
    }),
    { status: 200 },
  );
}

// v6.3: fetch dispatcher — 按 URL 路由 mockOk / mockAgentList。
// 兼顾旧的"全局 vi.fn(async () => mockOk(...))"用例不破坏。
function makeFetchRouter(handshakeResponse: () => Response) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/v1/agents')) {
      return mockAgentList();
    }
    return handshakeResponse();
  });
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
    // 注入默认 fetch mock：成功 + version 在范围内。
    // v6.3: 走 router 让 /v1/agents 走 AgentList mock，握手路径走 mockOk。
    vi.stubGlobal(
      'fetch',
      makeFetchRouter(() => mockOk('0.0.4')),
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
    expect(screen.getByLabelText(i18n.t('settings.urlAria'))).toBeInTheDocument();
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
    expect(await screen.findByText(i18n.t('settings.status.HEALTHY'))).toBeInTheDocument();
  });

  it('fetch 成功 + version out of range → PAIRED + MismatchBanner 显示', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetchRouter(() => mockOk('0.0.3')),
    );
    render(<App />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(await screen.findByText(i18n.t('settings.status.MISMATCH'))).toBeInTheDocument();
    expect(screen.getByText(/^Gateway v0\.0\.3 超出/)).toBeInTheDocument();
  });

  it('点 banner 关闭按钮 → banner 消失，session 内不重亮', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetchRouter(() => mockOk('0.0.3')),
    );
    render(<App />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('mismatch.dismiss') }));
    expect(screen.queryByText(/^Gateway v0\.0\.3 超出/)).toBeNull();

    // 推进 5 min fake timer + 触发 heartbeat
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });
    // banner 仍不显示
    expect(screen.queryByText(/^Gateway v0\.0\.3 超出/)).toBeNull();
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
    expect(await screen.findByText(i18n.t('settings.status.PAIR_FAILED'))).toBeInTheDocument();
    // NEED_REPAIR 同时点亮 PairBanner，文案含"重新配对"。
    expect(screen.getByText(i18n.t('pair.banner.needRepair.kicker'))).toBeInTheDocument();
  });

  it('secure-store 无 config → 直接 NEED_PAIR + PairBanner 显示"尚未配对"', async () => {
    mockLoad.mockResolvedValueOnce(null);
    render(<App />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(await screen.findByText(i18n.t('pair.banner.needPair.message'))).toBeInTheDocument();
  });

  it('PairBanner 点"去配对"按钮 → PairDialog 弹出', async () => {
    mockLoad.mockResolvedValueOnce(null);
    render(<App />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    fireEvent.click(
      await screen.findByRole('button', { name: i18n.t('pair.banner.actions.goPair') }),
    );
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('window 派发 my-ai:unauthorized → 进入 NEED_REPAIR 并弹 PairDialog', async () => {
    render(<App />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    // 先确认 PAIRED
    expect(await screen.findByText(i18n.t('settings.status.HEALTHY'))).toBeInTheDocument();
    // 模拟业务 401 派发
    await act(async () => {
      window.dispatchEvent(new CustomEvent('my-ai:unauthorized'));
    });
    expect(await screen.findByText(i18n.t('pair.banner.needRepair.kicker'))).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('已配对时点 Settings "测试" → 重跑握手（fetch 再次被调）', async () => {
    const fetchMock = makeFetchRouter(() => mockOk('0.0.4'));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(await screen.findByText(i18n.t('settings.status.HEALTHY'))).toBeInTheDocument();
    const callsBefore = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.test') }));
    // 立刻反馈 PAIRING
    expect(await screen.findByText(i18n.t('settings.status.PAIRING'))).toBeInTheDocument();

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
    // 仍 HEALTHY
    expect(await screen.findByText(i18n.t('settings.status.HEALTHY'))).toBeInTheDocument();
  });

  it('未配对时点 Settings "测试" → 直接弹 PairDialog（不开 Banner 那条路）', async () => {
    mockLoad.mockResolvedValueOnce(null);
    render(<App />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(await screen.findByText(i18n.t('pair.banner.needPair.message'))).toBeInTheDocument();
    // PairBanner 不会自动弹 dialog（需要点"去配对"），点 Settings 的"测试"应直接弹
    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.test') }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
