// PairDialog 组件测试：覆盖初始 render + 提交 + 私有模式轮询。
// v5: 文案断言改用 i18n.t(key)，与译文解耦。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

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
