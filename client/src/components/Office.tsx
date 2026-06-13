// 虚拟办公室画布根：拉取 agents + 渲染网格 / 空态 / 错误条。
// refetchKey 变化 → 重新拉取（父级删除 agent 后 bump）。
import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/lib/api.js';
import { listAgents } from '@/lib/agents.js';
import { AgentCard } from '@/components/AgentCard.js';
import { EmptyOffice } from '@/components/EmptyOffice.js';
import type { Agent } from '@/lib/types.js';

export type OfficeDialogKey =
  | { type: 'create-agent' }
  | { type: 'edit-agent'; agentId: string }
  | { type: 'chat'; agentId: string };

export type OfficeProps = {
  gatewayUrl: string;
  clientKey: string;
  refetchKey: number;
  onOpenDialog: (key: OfficeDialogKey) => void;
  onRefetch: () => void;
};

export function Office({
  gatewayUrl,
  clientKey,
  refetchKey,
  onOpenDialog,
  onRefetch,
}: OfficeProps): ReactElement {
  const { t } = useTranslation();
  const [state, setState] = useState<{
    agents: Agent[];
    loading: boolean;
    error: string | null;
  }>({ agents: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: null }));
    listAgents(gatewayUrl, clientKey)
      .then(agents => {
        if (!cancelled) {
          setState({ agents, loading: false, error: null });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) {
          return;
        }
        if (e instanceof ApiError && e.code === 401) {
          window.dispatchEvent(new CustomEvent('my-ai:unauthorized'));
          return;
        }
        const msg = e instanceof Error ? e.message : String(e);
        setState(s => ({ ...s, loading: false, error: msg }));
      });
    return () => {
      cancelled = true;
    };
  }, [gatewayUrl, clientKey, refetchKey]);

  return (
    <section aria-label={t('office.title')} style={{ margin: '16px 0' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18 }}>{t('office.title')}</h2>
        <button
          type="button"
          className="btn"
          onClick={() => onOpenDialog({ type: 'create-agent' })}
          style={{ background: 'var(--accent)', color: '#fff' }}
          disabled={state.loading}
        >
          {t('office.addAgent')}
        </button>
      </header>
      {state.error && (
        <div
          role="alert"
          style={{
            padding: 12,
            marginBottom: 16,
            background: 'var(--accent)',
            color: '#fff',
            borderRadius: 4,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{t('office.error.loadAgents', { msg: state.error })}</span>
          <button
            type="button"
            className="btn"
            onClick={() => onRefetch()}
            style={{ background: '#fff', color: 'var(--accent)' }}
          >
            {t('office.error.retry')}
          </button>
        </div>
      )}
      {state.loading ? (
        <div className="agent-card-grid" aria-busy="true">
          {[0, 1, 2].map(i => (
            <div key={i} className="agent-card-skeleton" />
          ))}
          <span style={{ position: 'absolute' }}>{t('office.loading')}</span>
        </div>
      ) : state.agents.length === 0 ? (
        <EmptyOffice onCreate={() => onOpenDialog({ type: 'create-agent' })} />
      ) : (
        <div className="agent-card-grid">
          {state.agents.map(a => (
            <AgentCard
              key={a.id}
              agent={a}
              onChat={() => onOpenDialog({ type: 'chat', agentId: a.id })}
              onEdit={() => onOpenDialog({ type: 'edit-agent', agentId: a.id })}
              onDelete={() => onOpenDialog({ type: 'edit-agent', agentId: a.id })}
            />
          ))}
        </div>
      )}
    </section>
  );
}
