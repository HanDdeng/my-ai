// 单 agent 卡片：name / description / 只读 capabilities chips / 右上角 hover 编辑删除按钮。
// 点卡片主体 → onChat；点按钮 → 阻止冒泡 → 调 onEdit / onDelete。
import type { ReactElement, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Agent } from '@/lib/types.js';

export type AgentCardProps = {
  agent: Agent;
  onChat: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

export function AgentCard({ agent, onChat, onEdit, onDelete }: AgentCardProps): ReactElement {
  const { t } = useTranslation();
  const stop = (cb: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    cb();
  };
  return (
    <div
      className="agent-card"
      onClick={onChat}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          onChat();
        }
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 14, color: 'var(--text)' }}>{agent.name}</h3>
          <p
            style={{
              margin: '0 0 8px',
              fontSize: 12,
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {agent.description}
          </p>
          {agent.capabilities.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {agent.capabilities.map(c => (
                <span
                  key={c}
                  style={{
                    fontSize: 10,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: 'var(--chip-bg)',
                    color: 'var(--text-muted)',
                  }}
                >
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: 4, marginLeft: 8, opacity: 0.6 }}
        >
          <button
            type="button"
            onClick={stop(onEdit)}
            aria-label={t('agentCard.edit')}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
            }}
          >
            {t('agentCard.edit')}
          </button>
          <button
            type="button"
            onClick={stop(onDelete)}
            aria-label={t('agentCard.delete')}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--accent)',
            }}
          >
            {t('agentCard.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
