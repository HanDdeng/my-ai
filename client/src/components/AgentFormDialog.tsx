// 新建/编辑 agent 弹窗：8 字段（capabilities 隐藏）+ zod 客户端校验 + 提交 + 嵌套 ConfirmDialog 删除。
// mode=create/edit；edit 模式 getAgent 加载数据；提交 createAgent/updateAgent。
import { useState, useEffect, useRef, type ReactElement, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useDialogAnimation } from '@/lib/use-dialog-animation.js';
import { ApiError } from '@/lib/api.js';
import { createAgent, getAgent, updateAgent, deleteAgent } from '@/lib/agents.js';
import { ConfirmDialog } from '@/components/ConfirmDialog.js';
import type { Agent } from '@/lib/types.js';

const FormSchema = z.object({
  name: z.string().min(1, 'nameRequired').max(64, 'nameLength'),
  description: z.string().max(256).default(''),
  baseUrl: z.string().min(1, 'baseUrlRequired').max(512),
  model: z.string().min(1, 'modelRequired').max(128),
  maxTokens: z.union([z.literal(''), z.coerce.number().int().min(1).max(32000)]).default(''),
  enabledApi: z.boolean().default(false),
  systemPrompt: z.string().max(8192).default(''),
});

const EMPTY: Omit<Agent, 'id' | 'createdAt' | 'updatedAt' | 'capabilities'> = {
  name: '',
  description: '',
  llmProvider: 'openai-compatible',
  baseUrl: '',
  model: '',
  maxTokens: null,
  enabledApi: false,
  systemPrompt: '',
};

export type AgentFormDialogProps = {
  mode: 'create' | 'edit';
  agentId?: string;
  gatewayUrl: string;
  clientKey: string;
  onClose: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
};

export function AgentFormDialog(props: AgentFormDialogProps): ReactElement {
  const { t } = useTranslation();
  const { mode, agentId, gatewayUrl, clientKey, onClose, onSaved, onDeleted } = props;
  const { isClosing, close, onOverlayClick } = useDialogAnimation(onClose);
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [nameConflict, setNameConflict] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const autoCloseRef = useRef<number | null>(null);

  // edit 模式：加载 agent
  useEffect(() => {
    if (mode !== 'edit' || !agentId) {
      return;
    }
    let cancelled = false;
    getAgent(gatewayUrl, clientKey, agentId)
      .then(a => {
        if (cancelled) {
          return;
        }
        setForm({
          name: a.name,
          description: a.description,
          llmProvider: a.llmProvider,
          baseUrl: a.baseUrl,
          model: a.model,
          maxTokens: a.maxTokens,
          enabledApi: a.enabledApi,
          systemPrompt: a.systemPrompt,
        });
      })
      .catch((e: unknown) => {
        if (cancelled) {
          return;
        }
        if (e instanceof ApiError && e.code === 404) {
          setLoadError('notFound');
          autoCloseRef.current = window.setTimeout(() => onClose(), 1500);
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
  }, [mode, agentId, gatewayUrl, clientKey, onClose]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setNameConflict(false);
    setSubmitError(null);
    // maxTokens 在 UI 层用 null 表示"留空"；提交前转成 '' 让 zod 接受。
    const candidate = { ...form, maxTokens: form.maxTokens === null ? '' : form.maxTokens };
    const parsed = FormSchema.safeParse(candidate);
    if (!parsed.success) {
      setSubmitError(parsed.error.issues[0]?.message ?? 'invalid');
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        ...parsed.data,
        llmProvider: 'openai-compatible' as const,
        capabilities: [] as string[],
        maxTokens: parsed.data.maxTokens === '' ? null : (parsed.data.maxTokens as number),
      };
      if (mode === 'create') {
        await createAgent(gatewayUrl, clientKey, body);
      } else {
        await updateAgent(gatewayUrl, clientKey, agentId!, body);
      }
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.code === 401) {
        window.dispatchEvent(new CustomEvent('my-ai:unauthorized'));
        return;
      }
      if (e instanceof ApiError && e.code === 409) {
        setNameConflict(true);
        return;
      }
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const onDeleteConfirm = async () => {
    if (!agentId) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAgent(gatewayUrl, clientKey, agentId);
      onDeleted?.();
    } catch (e) {
      if (e instanceof ApiError && e.code === 401) {
        window.dispatchEvent(new CustomEvent('my-ai:unauthorized'));
        return;
      }
      setDeleteError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
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
        style={{ width: '50vw', maxWidth: 600 }}
        role="dialog"
        aria-modal="true"
        aria-label={t(`agentForm.title.${mode}`)}
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
          <h2 style={{ margin: 0, fontSize: 16 }}>{t(`agentForm.title.${mode}`)}</h2>
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
        {loadError ? (
          <div style={{ padding: 32, color: 'var(--accent)' }} role="alert">
            {loadError === 'notFound'
              ? t('agentForm.errors.notFound')
              : t('agentForm.errors.loadFailed', { msg: loadError })}
          </div>
        ) : (
          <form
            onSubmit={onSubmit}
            style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
          >
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('agentForm.field.name.label')} *
                </label>
                <input
                  type="text"
                  className="input"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder={t('agentForm.field.name.placeholder')}
                  maxLength={64}
                  disabled={submitting}
                  aria-label={t('agentForm.field.name.label')}
                  style={{
                    width: '100%',
                    padding: 8,
                    background: 'var(--panel-bg)',
                    border: `1px solid ${nameConflict ? 'var(--accent)' : 'var(--border)'}`,
                    color: 'var(--text)',
                    borderRadius: 4,
                  }}
                />
                {nameConflict && (
                  <div className="field-error" role="alert">
                    {t('agentForm.errors.nameConflict')}
                  </div>
                )}
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('agentForm.field.description.label')}
                </label>
                <input
                  type="text"
                  className="input"
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  placeholder={t('agentForm.field.description.placeholder')}
                  maxLength={256}
                  disabled={submitting}
                  aria-label={t('agentForm.field.description.label')}
                  style={{
                    width: '100%',
                    padding: 8,
                    background: 'var(--panel-bg)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    borderRadius: 4,
                  }}
                />
              </div>
              <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                <legend style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                  {t('agentForm.section.llm')}
                </legend>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    type="text"
                    className="input"
                    value={form.baseUrl}
                    onChange={e => setForm({ ...form, baseUrl: e.target.value })}
                    placeholder={t('agentForm.field.baseUrl.placeholder')}
                    maxLength={512}
                    disabled={submitting}
                    aria-label={t('agentForm.field.baseUrl.label')}
                    style={{
                      width: '100%',
                      padding: 8,
                      background: 'var(--panel-bg)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      borderRadius: 4,
                    }}
                  />
                  <input
                    type="text"
                    className="input"
                    value={form.model}
                    onChange={e => setForm({ ...form, model: e.target.value })}
                    placeholder={t('agentForm.field.model.placeholder')}
                    maxLength={128}
                    disabled={submitting}
                    aria-label={t('agentForm.field.model.label')}
                    style={{
                      width: '100%',
                      padding: 8,
                      background: 'var(--panel-bg)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      borderRadius: 4,
                    }}
                  />
                  <input
                    type="number"
                    className="input"
                    value={form.maxTokens === null ? '' : String(form.maxTokens)}
                    onChange={e =>
                      setForm({
                        ...form,
                        maxTokens: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    placeholder={t('agentForm.field.maxTokens.placeholder')}
                    min={1}
                    max={32000}
                    disabled={submitting}
                    aria-label={t('agentForm.field.maxTokens.label')}
                    style={{
                      width: '100%',
                      padding: 8,
                      background: 'var(--panel-bg)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      borderRadius: 4,
                    }}
                  />
                </div>
              </fieldset>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('agentForm.field.systemPrompt.label')}
                </label>
                <textarea
                  className="input"
                  value={form.systemPrompt}
                  onChange={e => setForm({ ...form, systemPrompt: e.target.value })}
                  placeholder={t('agentForm.field.systemPrompt.placeholder')}
                  maxLength={8192}
                  rows={4}
                  disabled={submitting}
                  aria-label={t('agentForm.field.systemPrompt.label')}
                  style={{
                    width: '100%',
                    padding: 8,
                    background: 'var(--panel-bg)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    borderRadius: 4,
                    fontFamily: 'inherit',
                  }}
                />
              </div>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  color: 'var(--text-muted)',
                }}
              >
                <input
                  type="checkbox"
                  checked={form.enabledApi}
                  onChange={e => setForm({ ...form, enabledApi: e.target.checked })}
                  disabled={submitting}
                />
                {t('agentForm.field.enabledApi.label')}
                <span style={{ opacity: 0.6 }}>({t('agentForm.field.enabledApi.hint')})</span>
              </label>
              {submitError && (
                <div className="field-error" role="alert">
                  {t('agentForm.errors.saveFailed', { msg: submitError })}
                </div>
              )}
            </div>
            <footer
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                padding: 16,
                borderTop: '1px solid var(--border)',
              }}
            >
              <button type="button" className="btn" onClick={close} disabled={submitting}>
                {t('agentForm.actions.cancel')}
              </button>
              {mode === 'edit' && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowDelete(true)}
                  disabled={submitting}
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  {t('agentForm.actions.delete')}
                </button>
              )}
              <button
                type="submit"
                className="btn"
                disabled={submitting}
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                {t(`agentForm.actions.${mode === 'create' ? 'create' : 'save'}`)}
              </button>
            </footer>
          </form>
        )}
      </aside>
      {showDelete && (
        <ConfirmDialog
          title={t('confirm.deleteAgent.title')}
          message={t('confirm.deleteAgent.message')}
          confirmLabel={t('confirm.deleteAgent.confirm')}
          cancelLabel={t('confirm.deleteAgent.cancel')}
          onConfirm={onDeleteConfirm}
          onClose={() => {
            if (!deleting) {
              setShowDelete(false);
            }
          }}
        />
      )}
      {deleteError && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            padding: 12,
            background: 'var(--accent)',
            color: '#fff',
            borderRadius: 4,
            zIndex: 1001,
          }}
          role="alert"
        >
          {t('agentForm.errors.deleteFailed', { msg: deleteError })}
        </div>
      )}
    </>
  );
}
