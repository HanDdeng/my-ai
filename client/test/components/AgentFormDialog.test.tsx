// AgentFormDialog 组件测试：mode=create/edit + 8 字段 + 校验 + 提交 + 409 + 删除。
// mock 整个 agents lib（与 PairDialog 测试风格一致）。
// v6.3.1: 新增 contextWindow 字段 + 改用中文 i18n label（"名称" / "基础 URL" / "模型" / "上下文窗口"）。
// v6.5: apiKey 字段改为前端必填（zod min(1) + UI required）；后端仍 nullable + env fallback。
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
      // v6.4: per-agent apiKey。
      apiKey: 'sk-test-123',
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
    // v6.4: apiKey 字段也回填
    expect(screen.getByLabelText('API Key')).toHaveValue('sk-test-123');
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

  it('v6.5: apiKey 必填 → 提交成功（body 含 maxCompletionTokens=4096 + contextWindow=4096 + apiKey=sk-test）', async () => {
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
    // v6.5: apiKey 必填（之前可空 → null 回退到 env；现在 schema min(1)）。
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const call = vi.mocked(agentsLib.createAgent).mock.calls[0]!;
    const body = call[2] as Record<string, unknown>;
    // v6.3.2: 默认 4096（用户偏好，不再是 null）
    expect(body).toHaveProperty('maxCompletionTokens', 4096);
    // v6.4: contextWindow 留空统一落 4096（schema 默认；不再 null）
    expect(body).toHaveProperty('contextWindow', 4096);
    // v6.5: apiKey 必填后透传（不再 null）
    expect(body).toHaveProperty('apiKey', 'sk-test');
  });

  it('v6.5: apiKey 空 → 阻止提交 + 不调 createAgent', async () => {
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
    // 填必填字段但 apiKey 不填
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'echo' } });
    fireEvent.change(screen.getByLabelText('基础 URL'), { target: { value: 'http://x/v1' } });
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'm' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    // createAgent 不应被调（zod 校验失败 → setSubmitError 提前 return）
    await waitFor(() => {
      expect(agentsLib.createAgent).not.toHaveBeenCalled();
    });
  });

  it('v6.5.1: apiKey 纯空白 → 阻止提交（zod trim+min(1) 防绕过）', async () => {
    // v6.5.1: HTML required 只查 emptiness → "   " 通过 native 校验；但 zod .trim().min(1)
    //   会把 "   " 转为 "" 后触发 min(1) 失败 → setSubmitError 提前 return，createAgent 不被调。
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
    // 填必填字段，apiKey 用纯空白（fireEvent.change 绕过 HTML required native 校验）
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'echo' } });
    fireEvent.change(screen.getByLabelText('基础 URL'), { target: { value: 'http://x/v1' } });
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'm' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    // zod trim+min(1) 拦截 → createAgent 不被调
    await waitFor(() => {
      expect(agentsLib.createAgent).not.toHaveBeenCalled();
    });
  });

  it('v6.4: 填写 apiKey → 提交 body 含该值', async () => {
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
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-mine' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(agentsLib.createAgent).toHaveBeenCalled());
    const call = vi.mocked(agentsLib.createAgent).mock.calls[0]!;
    expect(call[2]).toHaveProperty('apiKey', 'sk-mine');
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
    // v6.5: apiKey 必填。
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(agentsLib.createAgent).toHaveBeenCalled());
    const call = vi.mocked(agentsLib.createAgent).mock.calls[0]!;
    expect(call[2]).toHaveProperty('contextWindow', 131072);
  });

  it('v6.4: contextWindow 留空 → 提交 body 含 4096（默认值落表）', async () => {
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
    // 故意把上下文窗口清空
    fireEvent.change(screen.getByLabelText('上下文窗口'), { target: { value: '' } });
    // v6.5: apiKey 必填。
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(agentsLib.createAgent).toHaveBeenCalled());
    const call = vi.mocked(agentsLib.createAgent).mock.calls[0]!;
    expect(call[2]).toHaveProperty('contextWindow', 4096);
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
    // v6.5: apiKey 必填。
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
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
    // v6.5: apiKey 必填，测试要走到 createAgent 调用也必须填上。
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
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
      // v6.4: per-agent apiKey。
      apiKey: null,
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
