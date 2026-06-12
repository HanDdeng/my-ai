// agent 弹窗：左侧消息流 + 底部输入；useReducer 状态机管消息流。
// session 懒创建：首条消息发送前 sessionId=null；发送时 createSession 一次，后续复用。
// 乐观更新：发消息时立刻 push user message（tempId 标记），server 返回后替换为 userMessage + append assistantMessage。
// 失败：标 tempId 消息 failed + 显示底部错误条 + 重试按钮。
// v6.5: 发送中加 spinner + 计时 + 取消按钮（AbortController abort fetch）。
import { useState, useEffect, useRef, useReducer, type ReactElement, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialogAnimation } from '@/lib/use-dialog-animation.js';
import { ApiError } from '@/lib/api.js';
import { getAgent } from '@/lib/agents.js';
import { createSession } from '@/lib/sessions.js';
import { postMessage } from '@/lib/messages.js';
import type { Agent, Message } from '@/lib/types.js';

type ChatState =
  | { kind: 'idle' }
  // v6.5: sending 状态带 startedAt，用于按钮显示已耗时秒数
  | { kind: 'sending'; pending: { tempId: string; content: string }; startedAt: number }
  | { kind: 'error'; pending: { tempId: string; content: string } | null; error: string };

type ChatAction =
  | { type: 'send-start'; tempId: string; content: string }
  | { type: 'send-success' }
  | { type: 'send-error'; error: string }
  | { type: 'retry' };

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'send-start':
      return {
        kind: 'sending',
        pending: { tempId: action.tempId, content: action.content },
        startedAt: Date.now(),
      };
    case 'send-success':
      return { kind: 'idle' };
    case 'send-error':
      return {
        kind: 'error',
        pending: state.kind === 'sending' ? state.pending : null,
        error: action.error,
      };
    case 'retry':
      if (state.kind === 'error' && state.pending) {
        // v6.5: retry 复用 pending 文本，但重置 startedAt 让计时从 0 开始
        return { kind: 'sending', pending: state.pending, startedAt: Date.now() };
      }
      return state;
  }
}

export type ChatDialogProps = {
  agentId: string;
  gatewayUrl: string;
  clientKey: string;
  onClose: () => void;
  onAgentDeleted: () => void;
};

export function ChatDialog({
  agentId,
  gatewayUrl,
  clientKey,
  onClose,
  onAgentDeleted,
}: ChatDialogProps): ReactElement {
  const { t } = useTranslation();
  const { isClosing, close, onOverlayClick } = useDialogAnimation(onClose);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [state, dispatch] = useReducer(chatReducer, { kind: 'idle' });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const autoCloseRef = useRef<number | null>(null);
  // v6.5: 发送中的 AbortController；onCancel 直接 abort 当前 fetch
  const abortRef = useRef<AbortController | null>(null);
  // v6.5: 计时器每 1s 触发一次 re-render，让按钮上的秒数走起来
  const [_tick, setTick] = useState(0);
  // 用 ref 保存 onAgentDeleted：避免父组件每次 render 传新函数导致下方 effect 重跑（重新加载 agent）
  const onAgentDeletedRef = useRef(onAgentDeleted);
  onAgentDeletedRef.current = onAgentDeleted;

  // v6.5: sending 状态下每秒 +1 tick 触发 re-render 刷新已耗时秒数
  useEffect(() => {
    if (state.kind !== 'sending') {
      return;
    }
    const id = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [state.kind]);

  // v6.5: 用户点"取消" → abort 当前 fetch，错误条显示"已取消"
  const onCancel = () => {
    abortRef.current?.abort();
    dispatch({ type: 'send-error', error: t('chat.cancelled') });
  };

  // 加载 agent
  useEffect(() => {
    let cancelled = false;
    getAgent(gatewayUrl, clientKey, agentId)
      .then(a => {
        if (!cancelled) {
          setAgent(a);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) {
          return;
        }
        if (e instanceof ApiError && e.code === 404) {
          setLoadError('notFound');
          // spec §5.5.2: agent 被删 → 显示半屏提示 1.5s 后通知父组件（父组件会关闭弹窗 + 刷新列表）
          autoCloseRef.current = window.setTimeout(() => onAgentDeletedRef.current(), 1500);
        } else if (e instanceof ApiError && e.code === 401) {
          window.dispatchEvent(new CustomEvent('my-ai:unauthorized'));
        } else {
          setLoadError(String(e instanceof Error ? e.message : e));
        }
      });
    return () => {
      cancelled = true;
      if (autoCloseRef.current !== null) {
        clearTimeout(autoCloseRef.current);
        autoCloseRef.current = null;
      }
    };
  }, [agentId, gatewayUrl, clientKey]);

  // 滚动到底部（jsdom 缺 scrollIntoView 实现，加可选链保护）
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages.length]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (state.kind !== 'idle' || !input.trim()) {
      return;
    }
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const content = input.trim();
    const optimistic: Message = {
      id: tempId,
      sessionId: sessionId ?? 'pending',
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages(m => [...m, optimistic]);
    setInput('');
    dispatch({ type: 'send-start', tempId, content });
    // v6.5: 创建 AbortController 并把 signal 传给 postMessage，以便"取消"按钮 abort fetch
    abortRef.current = new AbortController();
    try {
      let sid = sessionId;
      if (!sid) {
        const session = await createSession(gatewayUrl, clientKey, agentId);
        sid = session.id;
        setSessionId(sid);
      }
      const res = await postMessage(gatewayUrl, clientKey, sid, content, abortRef.current.signal);
      setMessages(m => [...m.filter(x => x.id !== tempId), res.userMessage, res.assistantMessage]);
      dispatch({ type: 'send-success' });
    } catch (e) {
      if (e instanceof ApiError && e.code === 401) {
        window.dispatchEvent(new CustomEvent('my-ai:unauthorized'));
        dispatch({ type: 'send-success' });
        return;
      }
      // v6.5: 用户点"取消"触发的 abort 抛 DOMException(AbortError)，
      // 此时 onCancel 已经把 error 置为 "已取消"，这里不要覆盖。
      if (e instanceof DOMException && e.name === 'AbortError') {
        return;
      }
      setMessages(m =>
        m.map(x => (x.id === tempId ? { ...x, content: `${x.content} (失败)` } : x)),
      );
      // v6.5: 区分 timeout vs 一般 5xx；带原因文案。gateway 502 现在 message 形如
      //   "upstream_error: <reason>"（如 "upstream_error: fetch failed: The operation was aborted"）。
      let msg: string;
      if (e instanceof ApiError && e.code === 502) {
        const raw = (e.message ?? '').toString();
        if (/timeout|TIMEOUT|UND_ERR_HEADERS_TIMEOUT|AbortError/i.test(raw)) {
          msg = t('chat.errors.upstreamTimeout');
        } else {
          msg = t('chat.errors.upstreamWithReason', { reason: raw || 'unknown' });
        }
      } else {
        msg = t('chat.errors.sendFailed', { msg: e instanceof Error ? e.message : String(e) });
      }
      dispatch({ type: 'send-error', error: msg });
    }
  };

  const onRetry = async () => {
    if (state.kind !== 'error' || !state.pending) {
      return;
    }
    const { tempId, content } = state.pending;
    dispatch({ type: 'retry' });
    // v6.5: 重试也用 AbortController 走新 signal
    abortRef.current = new AbortController();
    try {
      let sid = sessionId;
      if (!sid) {
        const session = await createSession(gatewayUrl, clientKey, agentId);
        sid = session.id;
        setSessionId(sid);
      }
      const res = await postMessage(gatewayUrl, clientKey, sid, content, abortRef.current.signal);
      setMessages(m => [...m.filter(x => x.id !== tempId), res.userMessage, res.assistantMessage]);
      dispatch({ type: 'send-success' });
    } catch (e) {
      // v6.5: 同上，retry 中途被取消不覆盖错误信息
      if (e instanceof DOMException && e.name === 'AbortError') {
        return;
      }
      dispatch({ type: 'send-error', error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <>
      <div
        className={`dialog-overlay ${isClosing ? 'is-closing' : ''}`}
        onClick={onOverlayClick}
        role="presentation"
      />
      <aside
        className={`dialog-drawer ${isClosing ? 'is-closing' : ''}`}
        style={{ width: '60vw', maxWidth: 720 }}
        role="dialog"
        aria-modal="true"
        aria-label={
          agent ? t('chat.title', { name: agent.name, sid: sessionId?.slice(0, 8) ?? '?' }) : 'chat'
        }
      >
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 16,
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            {agent ? `${agent.name} · ${messages.length} messages` : t('chat.sending')}
          </span>
          <button
            type="button"
            onClick={close}
            aria-label={t('common.close')}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 18,
            }}
          >
            ×
          </button>
        </header>
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {loadError ? (
            <div style={{ color: 'var(--accent)' }} role="alert">
              {t('chat.agentDeleted')}
            </div>
          ) : messages.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
              }}
            >
              {t('chat.empty')}
            </div>
          ) : (
            <>
              {messages.map(m => (
                <div key={m.id} className={`message-row-${m.role}`}>
                  <div
                    className={`message-bubble message-bubble-${m.role}${m.id.startsWith('tmp-') ? ' message-bubble-failed' : ''}`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>
        {state.kind === 'error' && (
          <div
            style={{
              padding: 12,
              background: 'var(--accent)',
              color: '#fff',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
            role="alert"
          >
            <span>{state.error}</span>
            <button
              type="button"
              className="btn"
              onClick={onRetry}
              style={{ background: '#fff', color: 'var(--accent)' }}
            >
              {t('chat.retry')}
            </button>
          </div>
        )}
        <form
          onSubmit={onSubmit}
          style={{ display: 'flex', gap: 8, padding: 16, borderTop: '1px solid var(--border)' }}
        >
          <textarea
            className="input"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={t('chat.placeholder')}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void onSubmit(e as unknown as FormEvent);
              }
            }}
            disabled={state.kind === 'sending'}
            rows={1}
            aria-label={t('chat.placeholder')}
            style={{
              flex: 1,
              padding: 8,
              background: 'var(--panel-bg)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              borderRadius: 4,
              fontFamily: 'inherit',
              resize: 'none',
            }}
          />
          <button
            type="submit"
            className="btn"
            disabled={!input.trim() || state.kind === 'sending'}
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {state.kind === 'sending' ? (
              <>
                {/* v6.5: 内联 spinner 圆环 + 已耗时秒数 */}
                <span className="spinner" aria-hidden="true" />
                {t('chat.sending')} {Math.floor((Date.now() - state.startedAt) / 1000)}s
              </>
            ) : (
              t('chat.send')
            )}
          </button>
          {state.kind === 'sending' && (
            // v6.5: 发送中暴露"取消"按钮 → 中断当前 fetch
            <button
              type="button"
              className="btn"
              onClick={onCancel}
              style={{ background: 'transparent', border: '1px solid var(--border)' }}
            >
              {t('chat.cancel')}
            </button>
          )}
        </form>
      </aside>
    </>
  );
}
