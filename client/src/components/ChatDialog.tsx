// agent 弹窗：左侧消息流 + 底部输入；useReducer 状态机管消息流。
// session 懒创建：首条消息发送前 sessionId=null；发送时 createSession 一次，后续复用。
// 乐观更新：发消息时立刻 push user message（tempId 标记），server 返回后替换为 userMessage + append assistantMessage。
// 失败：标 tempId 消息 failed + 显示底部错误条 + 重试按钮。
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
  | { kind: 'sending'; pending: { tempId: string; content: string } }
  | { kind: 'error'; pending: { tempId: string; content: string } | null; error: string };

type ChatAction =
  | { type: 'send-start'; tempId: string; content: string }
  | { type: 'send-success' }
  | { type: 'send-error'; error: string }
  | { type: 'retry' };

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'send-start':
      return { kind: 'sending', pending: { tempId: action.tempId, content: action.content } };
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
        return { kind: 'sending', pending: state.pending };
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
  // 当前实现未消费 onAgentDeleted（agent 删除后弹窗会在加载阶段 404 提示用户），保留在 props 以便后续实现错误提示/重试或列表同步
  void onAgentDeleted;
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
          autoCloseRef.current = window.setTimeout(() => onClose(), 1500);
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
  }, [agentId, gatewayUrl, clientKey, onClose]);

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
    try {
      let sid = sessionId;
      if (!sid) {
        const session = await createSession(gatewayUrl, clientKey, agentId);
        sid = session.id;
        setSessionId(sid);
      }
      const res = await postMessage(gatewayUrl, clientKey, sid, content);
      setMessages(m => [...m.filter(x => x.id !== tempId), res.userMessage, res.assistantMessage]);
      dispatch({ type: 'send-success' });
    } catch (e) {
      if (e instanceof ApiError && e.code === 401) {
        window.dispatchEvent(new CustomEvent('my-ai:unauthorized'));
        dispatch({ type: 'send-success' });
        return;
      }
      setMessages(m =>
        m.map(x => (x.id === tempId ? { ...x, content: `${x.content} (失败)` } : x)),
      );
      const msg =
        e instanceof ApiError && e.code === 502
          ? t('chat.errors.upstream')
          : t('chat.errors.sendFailed', { msg: e instanceof Error ? e.message : String(e) });
      dispatch({ type: 'send-error', error: msg });
    }
  };

  const onRetry = async () => {
    if (state.kind !== 'error' || !state.pending) {
      return;
    }
    const { tempId, content } = state.pending;
    dispatch({ type: 'retry' });
    try {
      let sid = sessionId;
      if (!sid) {
        const session = await createSession(gatewayUrl, clientKey, agentId);
        sid = session.id;
        setSessionId(sid);
      }
      const res = await postMessage(gatewayUrl, clientKey, sid, content);
      setMessages(m => [...m.filter(x => x.id !== tempId), res.userMessage, res.assistantMessage]);
      dispatch({ type: 'send-success' });
    } catch (e) {
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
              重试
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
            {t('chat.send')}
          </button>
        </form>
      </aside>
    </>
  );
}
