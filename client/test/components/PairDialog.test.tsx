// PairDialog 组件测试：覆盖初始 render + 提交 + 私有模式轮询。
// v5: 文案断言改用 i18n.t(key)，与译文解耦。
// v6.5: 增加文件级 CSS 断言，确保 .dialog-backdrop z-index 高于 AgentFormDialog drawer，防止被遮挡。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/lib/api.js', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      public code: number,
      message: string,
      public data: unknown = null,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));
vi.mock('@/lib/secure-store.js', () => ({
  saveSecureConfig: vi.fn(),
}));

import { apiFetch, ApiError } from '@/lib/api.js';
import { PairDialog } from '@/components/PairDialog.js';
import i18n from '@/i18n/index.js';

describe('<PairDialog>', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it('初始 render：表单 + 提交按钮可见', () => {
    render(<PairDialog initialUrl="" clientKey="abc" onPaired={() => {}} onClose={() => {}} />);
    expect(screen.getByLabelText(i18n.t('pair.dialog.fields.url.label'))).toBeTruthy();
    expect(screen.getByLabelText(i18n.t('pair.dialog.fields.pairKey.aria'))).toBeTruthy();
    expect(screen.getByRole('button', { name: i18n.t('pair.dialog.actions.submit') })).toBeTruthy();
  });

  it('POST /pair 200 → 调 onPaired', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(undefined); // GET /health
    vi.mocked(apiFetch).mockResolvedValueOnce({ clientKey: 'k', name: 'alice' });
    const onPaired = vi.fn();
    render(
      <PairDialog initialUrl="http://gw" clientKey="k" onPaired={onPaired} onClose={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText(i18n.t('pair.dialog.fields.url.label')), {
      target: { value: 'http://gw' },
    });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pair.dialog.actions.submit') }));
    await waitFor(() =>
      expect(onPaired).toHaveBeenCalledWith({
        clientKey: 'k',
        name: 'alice',
        gatewayUrl: 'http://gw',
        pairKey: null,
      }),
    );
  });

  it('POST /pair 202 → 进入轮询 → PAIRED 后调 onPaired', async () => {
    vi.useFakeTimers();
    // 1) GET /health 探活
    vi.mocked(apiFetch).mockResolvedValueOnce(undefined);
    // 2) POST /pair 抛 ApiError(code=0) 表示 202 私有模式待解析
    vi.mocked(apiFetch).mockRejectedValueOnce(
      new ApiError(0, 'pair_pending', { token: 'tk', expiresAt: 0, pollUrl: '/pair/status' }),
    );
    // 3) 首次轮询：PENDING
    vi.mocked(apiFetch).mockResolvedValueOnce({ status: 'PENDING' });
    // 4) 第二次轮询：PAIRED
    vi.mocked(apiFetch).mockResolvedValueOnce({ status: 'PAIRED' });
    const onPaired = vi.fn();
    render(
      <PairDialog initialUrl="http://gw" clientKey="k" onPaired={onPaired} onClose={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText(i18n.t('pair.dialog.fields.url.label')), {
      target: { value: 'http://gw' },
    });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pair.dialog.actions.submit') }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(onPaired).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

// v6.5: 文件级 CSS 断言。jsdom 不解析外部 stylesheet，getComputedStyle 对类选择器返回空，
// 所以直接 readFileSync 读 styles.css 文本，用正则匹配 .dialog-backdrop 块里的 z-index。
// 这里的 z-index 必须 >= 1100，确保在 AgentFormDialog (drawer z-index 1000) 已打开时，
// pair 失败 401 触发的 PairDialog 能浮在 AgentForm drawer 之上。
it('styles.css 里 .dialog-backdrop z-index ≥ 1100 — 防止被 AgentFormDialog (drawer z-index 1000) 遮挡', () => {
  // vitest 在 jsdom 环境下 import.meta.url 不一定带 file:// 协议，用 process.cwd() 兜底。
  // pnpm filter 执行时 cwd 是 client/，因此 css 相对路径 = ../src/styles.css 不可用，
  // 直接用绝对相对路径：cwd/src/styles.css。
  const cssPath = resolve(process.cwd(), 'src/styles.css');
  const css = readFileSync(cssPath, 'utf8');
  // 找 .dialog-backdrop 块里的 z-index
  const block = css.match(/\.dialog-backdrop\s*\{[^}]+\}/);
  expect(block).toBeTruthy();
  const zMatch = block![0].match(/z-index:\s*(\d+)/);
  expect(zMatch).toBeTruthy();
  expect(Number(zMatch![1])).toBeGreaterThanOrEqual(1100);
});
