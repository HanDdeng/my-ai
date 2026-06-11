// AgentFormDialog 组件测试：mode=create/edit + 8 字段 + 校验 + 提交 + 409 + 删除。
// mock 整个 agents lib（与 PairDialog 测试风格一致）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApiError } from '@/lib/api.js';
import * as agentsLib from '@/lib/agents.js';
import { AgentFormDialog } from '@/components/AgentFormDialog.js';

vi.mock('@/lib/agents.js', () => ({
  listAgents: vi.fn(),
  getAgent: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
}));

describe('<AgentFormDialog>', () => {
  beforeEach(() => {
    vi.mocked(agentsLib.createAgent).mockReset();
    vi.mocked(agentsLib.getAgent).mockReset();
    vi.mocked(agentsLib.updateAgent).mockReset();
    vi.mocked(agentsLib.deleteAgent).mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mode=create：渲染空表单 + "创建" 按钮（无删除）', () => {
    render(
      <AgentFormDialog
        mode="create"
        gatewayUrl="http://gw"
        clientKey="ck"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText('新建 Agent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除' })).toBeNull();
  });

  it('mode=edit：getAgent 加载数据 + 填充表单 + 显示"保存"/"删除"', async () => {
    vi.mocked(agentsLib.getAgent).mockResolvedValue({
      id: 'a1',
      name: 'Echo',
      description: 'desc',
      llmProvider: 'openai-compatible',
      baseUrl: 'http://x',
      model: 'qwen',
      maxTokens: 2048,
      enabledApi: false,
      systemPrompt: 'sys',
      capabilities: [],
      createdAt: 't',
      updatedAt: 't',
    });
    render(
      <AgentFormDialog
        mode="edit"
        agentId="a1"
        gatewayUrl="http://gw"
        clientKey="ck"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByDisplayValue('Echo')).toBeInTheDocument());
    expect(screen.getByDisplayValue('http://x')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2048')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument();
  });

  it('name 空 → 阻止提交 + 字段下方提示', async () => {
    render(
      <AgentFormDialog
        mode="create"
        gatewayUrl="http://gw"
        clientKey="ck"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('NAME'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(agentsLib.createAgent).not.toHaveBeenCalled();
  });

  it('提交成功 → onSaved', async () => {
    vi.mocked(agentsLib.createAgent).mockResolvedValue({} as never);
    const onSaved = vi.fn();
    render(
      <AgentFormDialog
        mode="create"
        gatewayUrl="http://gw"
        clientKey="ck"
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );
    fireEvent.change(screen.getByLabelText('NAME'), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText('BASE URL'), { target: { value: 'http://x' } });
    fireEvent.change(screen.getByLabelText('MODEL'), { target: { value: 'm' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('409 agent_name_conflict → name 字段红字（不调 onSaved）', async () => {
    vi.mocked(agentsLib.createAgent).mockRejectedValue(new ApiError(409, 'agent_name_conflict'));
    const onSaved = vi.fn();
    render(
      <AgentFormDialog
        mode="create"
        gatewayUrl="http://gw"
        clientKey="ck"
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );
    fireEvent.change(screen.getByLabelText('NAME'), { target: { value: 'Echo' } });
    fireEvent.change(screen.getByLabelText('BASE URL'), { target: { value: 'http://x' } });
    fireEvent.change(screen.getByLabelText('MODEL'), { target: { value: 'm' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(screen.getByText('名称已被占用')).toBeInTheDocument());
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('删除流程：点"删除" → 弹 ConfirmDialog → 确认 → 调 deleteAgent + onDeleted', async () => {
    vi.mocked(agentsLib.getAgent).mockResolvedValue({
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
    });
    vi.mocked(agentsLib.deleteAgent).mockResolvedValue(null);
    const onDeleted = vi.fn();
    render(
      <AgentFormDialog
        mode="edit"
        agentId="a1"
        gatewayUrl="http://gw"
        clientKey="ck"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onDeleted={onDeleted}
      />,
    );
    await waitFor(() => expect(screen.getByDisplayValue('Echo')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(screen.getByText('删除 Agent')).toBeInTheDocument(); // ConfirmDialog 弹出
    // ConfirmDialog 内有"删除"按钮，form footer 也有"删除"按钮；用 alertdialog 锁定。
    fireEvent.click(screen.getByRole('alertdialog').querySelector('button.btn:last-of-type')!);
    await waitFor(() =>
      expect(agentsLib.deleteAgent).toHaveBeenCalledWith('http://gw', 'ck', 'a1'),
    );
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });
});
