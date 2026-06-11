// AgentFormDialog 组件测试：mode=create/edit + 8 字段 + 校验 + 提交 + 409 + 删除。
// mock 整个 agents lib（与 PairDialog 测试风格一致）。
// v6.3.1: 新增 contextWindow 字段 + 改用中文 i18n label（"名称" / "基础 URL" / "模型" / "上下文窗口"）。
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
      // v6.3.2: 改用 maxCompletionTokens。
      maxCompletionTokens: 2048,
      contextWindow: 65536,
      // v6.3.2: 新增 reasoningEffort。
      reasoningEffort: 'medium',
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
    // v6.3.2: 字段名改了 → 用 getByLabelText 定位（label "单次回复 Tokens（最大输出）"）。
    expect(screen.getByLabelText('单次回复 Tokens（最大输出）')).toHaveValue(2048);
    // v6.3.1: context window 字段也回填
    expect(screen.getByDisplayValue('65536')).toBeInTheDocument();
    // v6.3.2: reasoningEffort 字段回填（中度思考（medium））。
    expect(screen.getByLabelText('思考强度')).toHaveValue('medium');
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
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(agentsLib.createAgent).not.toHaveBeenCalled();
  });

  it('v6.3.2: 提交成功 → onSaved（body 含 maxCompletionTokens=4096 + contextWindow=null + reasoningEffort="none"）', async () => {
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
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText('基础 URL'), { target: { value: 'http://x' } });
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'm' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const call = vi.mocked(agentsLib.createAgent).mock.calls[0]!;
    const body = call[2] as Record<string, unknown>;
    // v6.3.2: 默认 4096（用户偏好，不再是 null）
    expect(body).toHaveProperty('maxCompletionTokens', 4096);
    // v6.3.1: 提交 body 应含 contextWindow 字段
    expect(body).toHaveProperty('contextWindow', null);
    // v6.3.2: reasoningEffort 默认 'none'
    expect(body).toHaveProperty('reasoningEffort', 'none');
  });

  it('v6.3.1: 填写 contextWindow → 提交 body 包含该值', async () => {
    vi.mocked(agentsLib.createAgent).mockResolvedValue({} as never);
    render(
      <AgentFormDialog
        mode="create"
        gatewayUrl="http://gw"
        clientKey="ck"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText('基础 URL'), { target: { value: 'http://x' } });
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'qwen3.5:4b' } });
    fireEvent.change(screen.getByLabelText('上下文窗口'), { target: { value: '131072' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(agentsLib.createAgent).toHaveBeenCalled());
    const call = vi.mocked(agentsLib.createAgent).mock.calls[0]!;
    expect(call[2]).toHaveProperty('contextWindow', 131072);
  });

  it('v6.3.2: reasoningEffort <select> 提供 6 选项 + 选 "high" → body 含 reasoningEffort=high', async () => {
    vi.mocked(agentsLib.createAgent).mockResolvedValue({} as never);
    render(
      <AgentFormDialog
        mode="create"
        gatewayUrl="http://gw"
        clientKey="ck"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    // 6 个 <option> 都应存在
    const select = screen.getByLabelText('思考强度') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map(o => o.value);
    expect(optionValues).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
    // 选 high
    fireEvent.change(select, { target: { value: 'high' } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText('基础 URL'), { target: { value: 'http://x' } });
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'o1' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(agentsLib.createAgent).toHaveBeenCalled());
    const call = vi.mocked(agentsLib.createAgent).mock.calls[0]!;
    expect(call[2]).toHaveProperty('reasoningEffort', 'high');
  });

  it('v6.3.2: maxCompletionTokens 默认值 4096（不是空 / 不是 null）', () => {
    render(
      <AgentFormDialog
        mode="create"
        gatewayUrl="http://gw"
        clientKey="ck"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    const maxCompletionInput = screen.getByLabelText(
      '单次回复 Tokens（最大输出）',
    ) as HTMLInputElement;
    expect(maxCompletionInput.value).toBe('4096');
  });

  it('v6.3.2: 修改 maxCompletionTokens → 提交 body 透传', async () => {
    vi.mocked(agentsLib.createAgent).mockResolvedValue({} as never);
    render(
      <AgentFormDialog
        mode="create"
        gatewayUrl="http://gw"
        clientKey="ck"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText('基础 URL'), { target: { value: 'http://x' } });
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'm' } });
    fireEvent.change(screen.getByLabelText('单次回复 Tokens（最大输出）'), {
      target: { value: '8192' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(agentsLib.createAgent).toHaveBeenCalled());
    const call = vi.mocked(agentsLib.createAgent).mock.calls[0]!;
    expect(call[2]).toHaveProperty('maxCompletionTokens', 8192);
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
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Echo' } });
    fireEvent.change(screen.getByLabelText('基础 URL'), { target: { value: 'http://x' } });
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'm' } });
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
      // v6.3.2: 改用 maxCompletionTokens。
      maxCompletionTokens: null,
      contextWindow: null,
      // v6.3.2: 新增 reasoningEffort。
      reasoningEffort: 'none',
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
