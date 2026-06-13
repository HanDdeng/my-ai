// ChatDialog 组件测试：useReducer 状态机 + lazy session + 乐观 user message + ESC 关闭。
// mock 3 lib（agents / sessions / messages）+ useDialogAnimation。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
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
      maxCompletionTokens: null,
      // v6.4: per-agent apiKey。
      apiKey: null,
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
      maxCompletionTokens: null,
      // v6.4: per-agent apiKey。
      apiKey: null,
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
        // v6.5: 发送中可取消 → postMessage 多传一个 AbortSignal
        expect.any(AbortSignal),
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
      maxCompletionTokens: null,
      // v6.4: per-agent apiKey。
      apiKey: null,
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
      maxCompletionTokens: null,
      // v6.4: per-agent apiKey。
      apiKey: null,
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
    // v6.5: 502 + message 不含 timeout 关键词 → 走 upstreamWithReason 分支。
    await waitFor(() => expect(screen.getByText(/上游服务出错/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  // v6.5: 502 + message 含 timeout 关键词 → 走 upstreamTimeout 分支。
  it('v6.5: 502 + timeout 关键词 → 显示 LLM 响应超时文案', async () => {
    vi.mocked(agentsLib.getAgent).mockResolvedValue({
      id: 'a1',
      name: 'Echo',
      description: '',
      llmProvider: 'openai-compatible',
      baseUrl: 'http://x',
      model: 'qwen',
      maxCompletionTokens: null,
      apiKey: null,
      contextWindow: null,
      enabledApi: false,
      systemPrompt: '',
      capabilities: [],
      createdAt: 't',
      updatedAt: 't',
    });
    vi.mocked(sessionsLib.createSession).mockResolvedValue({ id: 's1' } as never);
    // v6.5: message 形如 "upstream_error: fetch failed: The operation was aborted"
    vi.mocked(messagesLib.postMessage).mockRejectedValueOnce(
      new ApiError(502, 'upstream_error: AbortError'),
    );
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
    await waitFor(() => expect(screen.getByText(/LLM 响应超时/)).toBeInTheDocument());
  });

  it('ESC 键 → 触发动画关闭 + 150ms 后 onClose', async () => {
    vi.mocked(agentsLib.getAgent).mockResolvedValue({
      id: 'a1',
      name: 'Echo',
      description: '',
      llmProvider: 'openai-compatible',
      baseUrl: 'http://x',
      model: 'qwen',
      maxCompletionTokens: null,
      // v6.4: per-agent apiKey。
      apiKey: null,
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

  // v6.5: 发送中要有可视化反馈：按钮显示"生成中… {elapsedSec}s" + 取消按钮。
  it('v6.5: sending 时按钮显示"生成中… + 计时" + 取消按钮', async () => {
    vi.mocked(agentsLib.getAgent).mockResolvedValue({
      id: 'a1',
      name: 'echo',
      description: '',
      llmProvider: 'openai-compatible',
      baseUrl: 'http://x',
      model: 'qwen',
      maxCompletionTokens: null,
      apiKey: null,
      contextWindow: null,
      enabledApi: false,
      systemPrompt: '',
      capabilities: [],
      createdAt: 't',
      updatedAt: 't',
    });
    vi.mocked(sessionsLib.createSession).mockResolvedValue({ id: 's1' } as never);
    // postMessage 永远 pending，由测试控制何时 resolve
    let resolvePost!: (v: unknown) => void;
    vi.mocked(messagesLib.postMessage).mockReturnValue(
      new Promise(r => {
        resolvePost = r as never;
      }) as never,
    );
    render(
      <ChatDialog
        agentId="a1"
        gatewayUrl="http://gw"
        clientKey="ck"
        onClose={vi.fn()}
        onAgentDeleted={vi.fn()}
      />,
    );
    await waitFor(() => screen.getByPlaceholderText('输入消息…'));
    fireEvent.change(screen.getByPlaceholderText('输入消息…'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    // 按钮文案变 "生成中…" 之类的 sending 文案
    await waitFor(() => screen.getByRole('button', { name: /生成中…/ }));
    // 取消按钮出现
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    // 时间推进 3s 后按钮文案应包含数字秒数（正则匹配 \d+s）。
    // 用 act 包住 setInterval 推进，避免 react 警告 state update 没被 act 包。
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    await waitFor(() => screen.getByRole('button', { name: /生成中…\s*3s/ }));
    // 让 promise resolve，避免 cleanup 时未处理 promise
    await act(async () => {
      resolvePost({
        userMessage: { id: 'u1', sessionId: 's1', role: 'user', content: 'hi', createdAt: '' },
        assistantMessage: {
          id: 'a1',
          sessionId: 's1',
          role: 'assistant',
          content: 'ok',
          createdAt: '',
        },
      });
    });
  });

  // v6.5: 点取消 → 错误条显示"已取消"。
  it('v6.5: 点击取消 → 错误条显示"已取消"', async () => {
    vi.mocked(agentsLib.getAgent).mockResolvedValue({
      id: 'a1',
      name: 'echo',
      description: '',
      llmProvider: 'openai-compatible',
      baseUrl: 'http://x',
      model: 'qwen',
      maxCompletionTokens: null,
      apiKey: null,
      contextWindow: null,
      enabledApi: false,
      systemPrompt: '',
      capabilities: [],
      createdAt: 't',
      updatedAt: 't',
    });
    vi.mocked(sessionsLib.createSession).mockResolvedValue({ id: 's1' } as never);
    vi.mocked(messagesLib.postMessage).mockImplementation(
      (_gw, _ck, _sid, _c, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }) as never,
    );
    render(
      <ChatDialog
        agentId="a1"
        gatewayUrl="http://gw"
        clientKey="ck"
        onClose={vi.fn()}
        onAgentDeleted={vi.fn()}
      />,
    );
    await waitFor(() => screen.getByPlaceholderText('输入消息…'));
    fireEvent.change(screen.getByPlaceholderText('输入消息…'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => screen.getByRole('button', { name: '取消' }));
    // act 包住 cancel click：abort 触发 promise reject 的 microtask
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
    });
    await waitFor(() => expect(screen.getByText('已取消')).toBeInTheDocument());
    expect(messagesLib.postMessage).toHaveBeenCalled();
  });
});
