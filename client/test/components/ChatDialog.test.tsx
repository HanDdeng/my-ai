// ChatDialog 组件测试：useReducer 状态机 + lazy session + 乐观 user message + ESC 关闭。
// mock 3 lib（agents / sessions / messages）+ useDialogAnimation。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApiError } from '@/lib/api.js';
import * as agentsLib from '@/lib/agents.js';
import * as sessionsLib from '@/lib/sessions.js';
import * as messagesLib from '@/lib/messages.js';
import { ChatDialog } from '@/components/ChatDialog.js';

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

describe('<ChatDialog>', () => {
  beforeEach(() => {
    vi.mocked(agentsLib.getAgent).mockReset();
    vi.mocked(sessionsLib.createSession).mockReset();
    vi.mocked(messagesLib.postMessage).mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('打开：getAgent 加载 + 显示空状态', async () => {
    vi.mocked(agentsLib.getAgent).mockResolvedValue({
      id: 'a1',
      name: 'Echo',
      description: '',
      llmProvider: 'openai-compatible',
      baseUrl: 'http://x',
      model: 'qwen',
      maxTokens: null,
      contextWindow: null,
      enabledApi: false,
      systemPrompt: '',
      capabilities: [],
      createdAt: 't',
      updatedAt: 't',
    });
    render(
      <ChatDialog
        agentId="a1"
        gatewayUrl="http://gw"
        clientKey="ck"
        onClose={vi.fn()}
        onAgentDeleted={vi.fn()}
      />,
    );
    expect(screen.getByText('生成中…')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('发条消息开始对话')).toBeInTheDocument());
  });

  it('发首条消息：createSession + postMessage + 显示 user/assistant', async () => {
    vi.mocked(agentsLib.getAgent).mockResolvedValue({
      id: 'a1',
      name: 'Echo',
      description: '',
      llmProvider: 'openai-compatible',
      baseUrl: 'http://x',
      model: 'qwen',
      maxTokens: null,
      contextWindow: null,
      enabledApi: false,
      systemPrompt: '',
      capabilities: [],
      createdAt: 't',
      updatedAt: 't',
    });
    vi.mocked(sessionsLib.createSession).mockResolvedValue({ id: 's1' } as never);
    vi.mocked(messagesLib.postMessage).mockResolvedValue({
      userMessage: { id: 'um', sessionId: 's1', role: 'user', content: 'hi', createdAt: 't' },
      assistantMessage: {
        id: 'am',
        sessionId: 's1',
        role: 'assistant',
        content: 'echo',
        createdAt: 't',
      },
    });
    render(
      <ChatDialog
        agentId="a1"
        gatewayUrl="http://gw"
        clientKey="ck"
        onClose={vi.fn()}
        onAgentDeleted={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText('发条消息开始对话')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('输入消息…'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() =>
      expect(sessionsLib.createSession).toHaveBeenCalledWith('http://gw', 'ck', 'a1'),
    );
    await waitFor(() =>
      expect(messagesLib.postMessage).toHaveBeenCalledWith(
        'http://gw',
        'ck',
        expect.any(String),
        'hi',
      ),
    );
    await waitFor(() => expect(screen.getByText('echo')).toBeInTheDocument());
  });

  it('第二条消息：不调 createSession（已有 sessionId）', async () => {
    vi.mocked(agentsLib.getAgent).mockResolvedValue({
      id: 'a1',
      name: 'Echo',
      description: '',
      llmProvider: 'openai-compatible',
      baseUrl: 'http://x',
      model: 'qwen',
      maxTokens: null,
      contextWindow: null,
      enabledApi: false,
      systemPrompt: '',
      capabilities: [],
      createdAt: 't',
      updatedAt: 't',
    });
    vi.mocked(sessionsLib.createSession).mockResolvedValue({ id: 's1' } as never);
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
    render(
      <ChatDialog
        agentId="a1"
        gatewayUrl="http://gw"
        clientKey="ck"
        onClose={vi.fn()}
        onAgentDeleted={vi.fn()}
      />,
    );
    await waitFor(() => screen.getByText('发条消息开始对话'));
    fireEvent.change(screen.getByPlaceholderText('输入消息…'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(sessionsLib.createSession).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByPlaceholderText('输入消息…'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(messagesLib.postMessage).toHaveBeenCalledTimes(2));
    expect(sessionsLib.createSession).toHaveBeenCalledTimes(1);
  });

  it('postMessage 失败 → 错误条 + 重试按钮', async () => {
    vi.mocked(agentsLib.getAgent).mockResolvedValue({
      id: 'a1',
      name: 'Echo',
      description: '',
      llmProvider: 'openai-compatible',
      baseUrl: 'http://x',
      model: 'qwen',
      maxTokens: null,
      contextWindow: null,
      enabledApi: false,
      systemPrompt: '',
      capabilities: [],
      createdAt: 't',
      updatedAt: 't',
    });
    vi.mocked(sessionsLib.createSession).mockResolvedValue({ id: 's1' } as never);
    vi.mocked(messagesLib.postMessage)
      .mockRejectedValueOnce(new ApiError(502, 'upstream_error'))
      .mockResolvedValueOnce({
        userMessage: { id: 'u', sessionId: 's', role: 'user', content: 'hi', createdAt: 't' },
        assistantMessage: {
          id: 'a',
          sessionId: 's',
          role: 'assistant',
          content: 'echo',
          createdAt: 't',
        },
      });
    render(
      <ChatDialog
        agentId="a1"
        gatewayUrl="http://gw"
        clientKey="ck"
        onClose={vi.fn()}
        onAgentDeleted={vi.fn()}
      />,
    );
    await waitFor(() => screen.getByText('发条消息开始对话'));
    fireEvent.change(screen.getByPlaceholderText('输入消息…'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(screen.getByText(/上游服务不可用/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('ESC 键 → 触发动画关闭 + 150ms 后 onClose', async () => {
    vi.mocked(agentsLib.getAgent).mockResolvedValue({
      id: 'a1',
      name: 'Echo',
      description: '',
      llmProvider: 'openai-compatible',
      baseUrl: 'http://x',
      model: 'qwen',
      maxTokens: null,
      contextWindow: null,
      enabledApi: false,
      systemPrompt: '',
      capabilities: [],
      createdAt: 't',
      updatedAt: 't',
    });
    const onClose = vi.fn();
    render(
      <ChatDialog
        agentId="a1"
        gatewayUrl="http://gw"
        clientKey="ck"
        onClose={onClose}
        onAgentDeleted={vi.fn()}
      />,
    );
    await waitFor(() => screen.getByText('发条消息开始对话'));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('getAgent 404 → 显示 "agent 已被删除" + 1.5s 后 onAgentDeleted（不调 onClose）', async () => {
    // spec §5.5.2: agent 被删时 → 半屏提示 1.5s → onAgentDeleted
    vi.mocked(agentsLib.getAgent).mockRejectedValue(new ApiError(404, 'not_found'));
    const onClose = vi.fn();
    const onAgentDeleted = vi.fn();
    render(
      <ChatDialog
        agentId="a1"
        gatewayUrl="http://gw"
        clientKey="ck"
        onClose={onClose}
        onAgentDeleted={onAgentDeleted}
      />,
    );
    // 立即显示 "agent 已被删除" 提示
    await waitFor(() => expect(screen.getByText('agent 已被删除')).toBeInTheDocument());
    // 1.5s 内：onAgentDeleted 未被调用
    expect(onAgentDeleted).not.toHaveBeenCalled();
    // 1.5s 后：onAgentDeleted 被调用 1 次；onClose 未被直接调用（由父组件 onAgentDeleted 处理后关闭）
    await waitFor(() => expect(onAgentDeleted).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(onClose).not.toHaveBeenCalled();
  });
});
