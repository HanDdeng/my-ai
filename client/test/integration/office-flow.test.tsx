// 端到端集成测试：mock 整个 agents/sessions/messages lib + render wrapper with 父状态机。
// 覆盖 3 场景：建→聊；切 agent；401。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import * as agentsLib from '@/lib/agents.js';
import * as sessionsLib from '@/lib/sessions.js';
import * as messagesLib from '@/lib/messages.js';
import { Office, type OfficeDialogKey } from '@/components/Office.js';
import { AgentFormDialog } from '@/components/AgentFormDialog.js';
import { ChatDialog } from '@/components/ChatDialog.js';
import { ApiError } from '@/lib/api.js';
import type { Agent } from '@/lib/types.js';

vi.mock('@/lib/agents.js', () => ({
  listAgents: vi.fn(),
  getAgent: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
}));
vi.mock('@/lib/sessions.js', () => ({
  createSession: vi.fn(),
  getSession: vi.fn(),
  deleteSession: vi.fn(),
}));
vi.mock('@/lib/messages.js', () => ({
  listMessages: vi.fn(),
  postMessage: vi.fn(),
}));

type OfficeFlowProps = {
  // 预留 props 便于后续扩展（initialAgents seed），目前未消费。
  initialAgents?: never;
  // 透传到 ChatDialog.onClose 的测试 spy，用于断言"404 不自动调 onClose"等场景。
  onClose?: () => void;
};

function OfficeFlow({ onClose }: OfficeFlowProps = {}) {
  const [dialog, setDialog] = useState<OfficeDialogKey | null>(null);
  const [refetchKey, setRefetchKey] = useState(0);
  const gw = 'http://gw';
  const ck = 'ck';
  return (
    <>
      <Office
        gatewayUrl={gw}
        clientKey={ck}
        refetchKey={refetchKey}
        onOpenDialog={setDialog}
        onRefetch={() => setRefetchKey((k: number) => k + 1)}
      />
      {dialog?.type === 'create-agent' && (
        <AgentFormDialog
          mode="create"
          gatewayUrl={gw}
          clientKey={ck}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            setRefetchKey((k: number) => k + 1);
          }}
        />
      )}
      {dialog?.type === 'edit-agent' && (
        <AgentFormDialog
          mode="edit"
          agentId={dialog.agentId}
          gatewayUrl={gw}
          clientKey={ck}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            setRefetchKey((k: number) => k + 1);
          }}
          onDeleted={() => {
            setDialog(null);
            setRefetchKey((k: number) => k + 1);
          }}
        />
      )}
      {dialog?.type === 'chat' && (
        <ChatDialog
          agentId={dialog.agentId}
          gatewayUrl={gw}
          clientKey={ck}
          onClose={() => {
            setDialog(null);
            onClose?.();
          }}
          onAgentDeleted={() => {
            setDialog(null);
            setRefetchKey((k: number) => k + 1);
          }}
        />
      )}
    </>
  );
}

describe('Integration: office flow', () => {
  beforeEach(() => {
    vi.mocked(agentsLib.listAgents).mockReset();
    vi.mocked(agentsLib.getAgent).mockReset();
    vi.mocked(agentsLib.createAgent).mockReset();
    vi.mocked(agentsLib.updateAgent).mockReset();
    vi.mocked(agentsLib.deleteAgent).mockReset();
    vi.mocked(sessionsLib.createSession).mockReset();
    vi.mocked(messagesLib.postMessage).mockReset();
  });

  it('happy path: 空 → 新建 → 点弹窗 → 发消息 → 收回复', async () => {
    const created: Agent = {
      id: 'a1',
      name: 'Echo',
      description: '',
      llmProvider: 'openai-compatible',
      baseUrl: 'http://x',
      model: 'qwen',
      maxCompletionTokens: null,
      // v6.3.2: 新增 reasoningEffort 字段。
      reasoningEffort: 'none',
      contextWindow: null,
      enabledApi: false,
      systemPrompt: '',
      capabilities: [],
      createdAt: 't',
      updatedAt: 't',
    };
    vi.mocked(agentsLib.listAgents)
      .mockResolvedValueOnce([]) // 初始空
      .mockResolvedValueOnce([created]); // 提交后 refetch
    vi.mocked(agentsLib.createAgent).mockResolvedValue(created);
    vi.mocked(agentsLib.getAgent).mockResolvedValue(created);
    vi.mocked(sessionsLib.createSession).mockResolvedValue({
      id: 's1',
      agentId: 'a1',
      clientKey: 'ck',
      title: '',
      createdAt: 't',
      updatedAt: 't',
    });
    vi.mocked(messagesLib.postMessage).mockResolvedValue({
      userMessage: { id: 'u', sessionId: 's1', role: 'user', content: 'hi', createdAt: 't' },
      assistantMessage: {
        id: 'a',
        sessionId: 's1',
        role: 'assistant',
        content: 'echo',
        createdAt: 't',
      },
    });

    render(<OfficeFlow />);
    await waitFor(() => expect(screen.getByText('尚无 agent')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '新建 agent' }));
    await waitFor(() => expect(screen.getByText('新建 Agent')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Echo' } });
    fireEvent.change(screen.getByLabelText('基础 URL'), { target: { value: 'http://x' } });
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'qwen' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(screen.getByText('Echo')).toBeInTheDocument());
    // 点卡片
    fireEvent.click(screen.getByText('Echo'));
    await waitFor(() => expect(screen.getByText('发条消息开始对话')).toBeInTheDocument());
    // 发消息
    fireEvent.change(screen.getByPlaceholderText('输入消息…'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(screen.getByText('echo')).toBeInTheDocument());
  });

  it('切 agent = 新 session（独立 chat）', async () => {
    const a1: Agent = {
      id: 'a1',
      name: 'Echo',
      description: '',
      llmProvider: 'openai-compatible',
      baseUrl: 'http://x',
      model: 'qwen',
      maxCompletionTokens: null,
      // v6.3.2: 新增 reasoningEffort 字段。
      reasoningEffort: 'none',
      contextWindow: null,
      enabledApi: false,
      systemPrompt: '',
      capabilities: [],
      createdAt: 't',
      updatedAt: 't',
    };
    const a2: Agent = {
      id: 'a2',
      name: 'Bot',
      description: '',
      llmProvider: 'openai-compatible',
      baseUrl: 'http://x',
      model: 'qwen',
      maxCompletionTokens: null,
      // v6.3.2: 新增 reasoningEffort 字段。
      reasoningEffort: 'none',
      contextWindow: null,
      enabledApi: false,
      systemPrompt: '',
      capabilities: [],
      createdAt: 't',
      updatedAt: 't',
    };
    vi.mocked(agentsLib.listAgents).mockResolvedValue([a1, a2]);
    vi.mocked(agentsLib.getAgent).mockImplementation(
      async (_gw: string, _ck: string, id: string) => (id === 'a1' ? a1 : a2),
    );
    vi.mocked(sessionsLib.createSession).mockResolvedValue({
      id: 's',
      agentId: 'a',
      clientKey: 'ck',
      title: '',
      createdAt: 't',
      updatedAt: 't',
    });
    vi.mocked(messagesLib.postMessage).mockResolvedValue({
      userMessage: { id: 'u', sessionId: 's', role: 'user', content: 'x', createdAt: 't' },
      assistantMessage: {
        id: 'a',
        sessionId: 's',
        role: 'assistant',
        content: 'y',
        createdAt: 't',
      },
    });
    render(<OfficeFlow />);
    await waitFor(() => expect(screen.getByText('Echo')).toBeInTheDocument());
    // 点 a1 卡片 → 发消息
    fireEvent.click(screen.getByText('Echo'));
    await waitFor(() => screen.getByText('发条消息开始对话'));
    fireEvent.change(screen.getByPlaceholderText('输入消息…'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(messagesLib.postMessage).toHaveBeenCalledTimes(1));
    // 关 dialog（× 按钮）
    fireEvent.click(screen.getByLabelText('关闭'));
    // 等 150ms 动画 + 卸载
    await new Promise(r => setTimeout(r, 200));
    // 点 a2 卡片 → 新 session
    fireEvent.click(screen.getByText('Bot'));
    await waitFor(() => screen.getByText('发条消息开始对话'));
    fireEvent.change(screen.getByPlaceholderText('输入消息…'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(sessionsLib.createSession).toHaveBeenCalledTimes(2));
  });

  it('listAgents 抛 401 → 派发 my-ai:unauthorized 事件', async () => {
    vi.mocked(agentsLib.listAgents).mockRejectedValue(new ApiError(401, 'unauthorized'));
    const spy = vi.spyOn(window, 'dispatchEvent');
    render(<OfficeFlow />);
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'my-ai:unauthorized' })),
    );
    spy.mockRestore();
  });

  it('edit 端到端: 点 ✎ → 加载数据 → 改名字 → 保存 → listAgents 重拉', async () => {
    const original: Agent = {
      id: 'a1',
      name: 'Echo',
      description: 'old',
      llmProvider: 'openai-compatible',
      baseUrl: 'http://x',
      model: 'qwen',
      maxCompletionTokens: null,
      // v6.3.2: 新增 reasoningEffort 字段。
      reasoningEffort: 'none',
      contextWindow: null,
      enabledApi: false,
      systemPrompt: '',
      capabilities: [],
      createdAt: 't',
      updatedAt: 't',
    };
    const updated = { ...original, name: 'Echo Renamed', description: 'new' };
    vi.mocked(agentsLib.listAgents)
      .mockResolvedValueOnce([original]) // 初始
      .mockResolvedValueOnce([updated]); // 保存后
    vi.mocked(agentsLib.getAgent).mockResolvedValue(original);
    vi.mocked(agentsLib.updateAgent).mockResolvedValue(updated);

    render(<OfficeFlow />);
    await waitFor(() => expect(screen.getByText('Echo')).toBeInTheDocument());

    // 点 ✎ 编辑按钮
    fireEvent.click(screen.getByLabelText('✎ 编辑'));
    await waitFor(() => expect(screen.getByText('编辑 Agent')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByDisplayValue('Echo')).toBeInTheDocument());

    // 改名字
    const nameInput = screen.getByLabelText('名称');
    fireEvent.change(nameInput, { target: { value: 'Echo Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(agentsLib.updateAgent).toHaveBeenCalledWith(
        'http://gw',
        'ck',
        'a1',
        expect.objectContaining({ name: 'Echo Renamed' }),
      ),
    );
    // App 关 dialog + bump refetchKey → listAgents 第二次被调
    await waitFor(() => expect(agentsLib.listAgents).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('Echo Renamed')).toBeInTheDocument());
    expect(screen.queryByText('Echo')).toBeNull();
  });

  it('delete 端到端: 点 ✎ → form 内点删除 → ConfirmDialog → 确认 → deleteAgent + onDeleted', async () => {
    const a1: Agent = {
      id: 'a1',
      name: 'Echo',
      description: '',
      llmProvider: 'openai-compatible',
      baseUrl: 'http://x',
      model: 'qwen',
      maxCompletionTokens: null,
      // v6.3.2: 新增 reasoningEffort 字段。
      reasoningEffort: 'none',
      contextWindow: null,
      enabledApi: false,
      systemPrompt: '',
      capabilities: [],
      createdAt: 't',
      updatedAt: 't',
    };
    vi.mocked(agentsLib.listAgents)
      .mockResolvedValueOnce([a1]) // 初始
      .mockResolvedValueOnce([]); // 删除后
    vi.mocked(agentsLib.getAgent).mockResolvedValue(a1);
    vi.mocked(agentsLib.deleteAgent).mockResolvedValue(null);

    render(<OfficeFlow />);
    await waitFor(() => expect(screen.getByText('Echo')).toBeInTheDocument());

    // 点 ✎
    fireEvent.click(screen.getByLabelText('✎ 编辑'));
    await waitFor(() => expect(screen.getByText('编辑 Agent')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByDisplayValue('Echo')).toBeInTheDocument());

    // 点 form 内"删除"按钮
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    // ConfirmDialog 弹出
    await waitFor(() => expect(screen.getByText('删除 Agent')).toBeInTheDocument());
    // 确认（alertdialog 内）
    const alertDialog = screen.getByRole('alertdialog');
    fireEvent.click(within(alertDialog).getByRole('button', { name: '删除' }));
    await waitFor(() =>
      expect(agentsLib.deleteAgent).toHaveBeenCalledWith('http://gw', 'ck', 'a1'),
    );
    // App 关 dialog + bump refetchKey
    await waitFor(() => expect(agentsLib.listAgents).toHaveBeenCalledTimes(2));
    // Echo 消失
    await waitFor(() => expect(screen.queryByText('Echo')).toBeNull());
  });

  it('ChatDialog 中 postMessage 404 → 显示错误 + 不自动调 onClose', async () => {
    const a1: Agent = {
      id: 'a1',
      name: 'Echo',
      description: '',
      llmProvider: 'openai-compatible',
      baseUrl: 'http://x',
      model: 'qwen',
      maxCompletionTokens: null,
      // v6.3.2: 新增 reasoningEffort 字段。
      reasoningEffort: 'none',
      contextWindow: null,
      enabledApi: false,
      systemPrompt: '',
      capabilities: [],
      createdAt: 't',
      updatedAt: 't',
    };
    vi.mocked(agentsLib.listAgents).mockResolvedValue([a1]);
    vi.mocked(agentsLib.getAgent).mockResolvedValue(a1);
    vi.mocked(sessionsLib.createSession).mockResolvedValue({
      id: 's',
      agentId: 'a1',
      clientKey: 'ck',
      title: '',
      createdAt: 't',
      updatedAt: 't',
    });
    vi.mocked(messagesLib.postMessage).mockRejectedValue(new ApiError(404, 'session_not_found'));
    const onClose = vi.fn();

    render(<OfficeFlow onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('Echo')).toBeInTheDocument());

    // 点卡片 → chat
    fireEvent.click(screen.getByText('Echo'));
    await waitFor(() => screen.getByText('发条消息开始对话'));

    // 发消息 → 404
    fireEvent.change(screen.getByPlaceholderText('输入消息…'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(messagesLib.postMessage).toHaveBeenCalled());
    // 错误条显示
    await waitFor(() => expect(screen.getByText(/发送失败/)).toBeInTheDocument());
    // 不自动调 onClose（用户可重试或手动关）
    expect(onClose).not.toHaveBeenCalled();
  });
});
