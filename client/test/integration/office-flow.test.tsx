// 端到端集成测试：mock 整个 agents/sessions/messages lib + render wrapper with 父状态机。
// 覆盖 3 场景：建→聊；切 agent；401。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import * as agentsLib from '@/lib/agents.js';
import * as sessionsLib from '@/lib/sessions.js';
import * as messagesLib from '@/lib/messages.js';
import { Office, type OfficeDialogKey } from '@/components/Office.js';
import { AgentFormDialog } from '@/components/AgentFormDialog.js';
import { ChatDialog } from '@/components/ChatDialog.js';
import { ApiError } from '@/lib/api.js';

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
};

function OfficeFlow(_props: OfficeFlowProps = {}) {
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
      {dialog?.type === 'chat' && (
        <ChatDialog
          agentId={dialog.agentId}
          gatewayUrl={gw}
          clientKey={ck}
          onClose={() => setDialog(null)}
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
    vi.mocked(sessionsLib.createSession).mockReset();
    vi.mocked(messagesLib.postMessage).mockReset();
  });

  it('happy path: 空 → 新建 → 点弹窗 → 发消息 → 收回复', async () => {
    const created = {
      id: 'a1',
      name: 'Echo',
      description: '',
      llmProvider: 'openai-compatible' as const,
      baseUrl: 'http://x',
      model: 'qwen',
      maxTokens: null,
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
    fireEvent.change(screen.getByLabelText('NAME'), { target: { value: 'Echo' } });
    fireEvent.change(screen.getByLabelText('BASE URL'), { target: { value: 'http://x' } });
    fireEvent.change(screen.getByLabelText('MODEL'), { target: { value: 'qwen' } });
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
    const a1 = {
      id: 'a1',
      name: 'Echo',
      description: '',
      llmProvider: 'openai-compatible' as const,
      baseUrl: 'http://x',
      model: 'qwen',
      maxTokens: null,
      enabledApi: false,
      systemPrompt: '',
      capabilities: [],
      createdAt: 't',
      updatedAt: 't',
    };
    const a2 = {
      id: 'a2',
      name: 'Bot',
      description: '',
      llmProvider: 'openai-compatible' as const,
      baseUrl: 'http://x',
      model: 'qwen',
      maxTokens: null,
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
});
