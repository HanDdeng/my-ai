// Office 组件测试：listAgents 拉取 + 加载/错误/网格 + 点 [+] / 点卡片回调。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApiError } from '@/lib/api.js';
import * as agentsLib from '@/lib/agents.js';
import { Office } from '@/components/Office.js';

vi.mock('@/lib/agents.js', () => ({
  listAgents: vi.fn(),
  getAgent: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
}));

describe('<Office>', () => {
  beforeEach(() => {
    vi.mocked(agentsLib.listAgents).mockReset();
  });

  it('初始 render：显示 loading 骨架', () => {
    vi.mocked(agentsLib.listAgents).mockReturnValue(new Promise(() => {})); // 永不 resolve
    render(
      <Office
        gatewayUrl="http://gw"
        clientKey="ck"
        refetchKey={0}
        onOpenDialog={vi.fn()}
        onRefetch={vi.fn()}
      />,
    );
    expect(screen.getByText('加载中…')).toBeInTheDocument();
  });

  it('listAgents resolve → 显示 agent 卡片 + [+] 按钮', async () => {
    vi.mocked(agentsLib.listAgents).mockResolvedValue([
      {
        id: 'a1',
        name: 'Echo',
        description: 'desc',
        llmProvider: 'openai-compatible',
        baseUrl: 'http://x',
        model: 'qwen',
        maxTokens: null,
        enabledApi: false,
        systemPrompt: '',
        capabilities: [],
        createdAt: 't',
        updatedAt: 't',
      },
    ]);
    render(
      <Office
        gatewayUrl="http://gw"
        clientKey="ck"
        refetchKey={0}
        onOpenDialog={vi.fn()}
        onRefetch={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText('Echo')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '+ 新建 agent' })).toBeInTheDocument();
  });

  it('list 返回 [] → 显示 EmptyOffice', async () => {
    vi.mocked(agentsLib.listAgents).mockResolvedValue([]);
    render(
      <Office
        gatewayUrl="http://gw"
        clientKey="ck"
        refetchKey={0}
        onOpenDialog={vi.fn()}
        onRefetch={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText('尚无 agent')).toBeInTheDocument());
  });

  it('listAgents 失败 → 显示错误条 + 重试按钮', async () => {
    vi.mocked(agentsLib.listAgents).mockRejectedValue(new ApiError(500, 'internal_error'));
    render(
      <Office
        gatewayUrl="http://gw"
        clientKey="ck"
        refetchKey={0}
        onOpenDialog={vi.fn()}
        onRefetch={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/^拉取 agent 列表失败：internal_error$/)).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('点 [+] → onOpenDialog({type: "create-agent"})', async () => {
    vi.mocked(agentsLib.listAgents).mockResolvedValue([]);
    const onOpenDialog = vi.fn();
    render(
      <Office
        gatewayUrl="http://gw"
        clientKey="ck"
        refetchKey={0}
        onOpenDialog={onOpenDialog}
        onRefetch={vi.fn()}
      />,
    );
    await waitFor(() => screen.getByText('尚无 agent'));
    fireEvent.click(screen.getByRole('button', { name: '新建 agent' })); // EmptyOffice 的 CTA
    expect(onOpenDialog).toHaveBeenCalledWith({ type: 'create-agent' });
  });

  it('点 agent 卡片 → onOpenDialog({type: "chat", agentId})', async () => {
    vi.mocked(agentsLib.listAgents).mockResolvedValue([
      {
        id: 'a1',
        name: 'Echo',
        description: '',
        llmProvider: 'openai-compatible',
        baseUrl: 'http://x',
        model: 'qwen',
        maxTokens: null,
        enabledApi: false,
        systemPrompt: '',
        capabilities: [],
        createdAt: 't',
        updatedAt: 't',
      },
    ]);
    const onOpenDialog = vi.fn();
    render(
      <Office
        gatewayUrl="http://gw"
        clientKey="ck"
        refetchKey={0}
        onOpenDialog={onOpenDialog}
        onRefetch={vi.fn()}
      />,
    );
    await waitFor(() => screen.getByText('Echo'));
    fireEvent.click(screen.getByText('Echo'));
    expect(onOpenDialog).toHaveBeenCalledWith({ type: 'chat', agentId: 'a1' });
  });

  it('refetchKey 变化 → 重新调 listAgents', async () => {
    vi.mocked(agentsLib.listAgents).mockResolvedValue([]);
    const { rerender } = render(
      <Office
        gatewayUrl="http://gw"
        clientKey="ck"
        refetchKey={0}
        onOpenDialog={vi.fn()}
        onRefetch={vi.fn()}
      />,
    );
    await waitFor(() => expect(agentsLib.listAgents).toHaveBeenCalledTimes(1));
    rerender(
      <Office
        gatewayUrl="http://gw"
        clientKey="ck"
        refetchKey={1}
        onOpenDialog={vi.fn()}
        onRefetch={vi.fn()}
      />,
    );
    await waitFor(() => expect(agentsLib.listAgents).toHaveBeenCalledTimes(2));
  });

  it('点错误条的重试按钮 → onRefetch 调用一次', async () => {
    vi.mocked(agentsLib.listAgents).mockRejectedValue(new ApiError(500, 'internal_error'));
    const onRefetch = vi.fn();
    render(
      <Office
        gatewayUrl="http://gw"
        clientKey="ck"
        refetchKey={0}
        onOpenDialog={vi.fn()}
        onRefetch={onRefetch}
      />,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRefetch).toHaveBeenCalledTimes(1);
  });
});
