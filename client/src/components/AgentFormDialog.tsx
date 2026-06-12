// 新建/编辑 agent 弹窗：8 字段（capabilities 隐藏）+ zod 客户端校验 + 提交 + 嵌套 ConfirmDialog 删除。
// mode=create/edit；edit 模式 getAgent 加载数据；提交 createAgent/updateAgent。
// v6.3.1: 新增 contextWindow 字段（位于 maxTokens 下方）。
// v6.3.2: maxTokens 字段名改为 maxCompletionTokens（OpenAI 新 SDK 字段对齐）。
// v6.4: 移除 reasoningEffort 表单字段（不再持久化；改由消息接口传参，硬编码 'none'）；
//   新增 apiKey 字段（per-agent 凭据，nullable，回退到 env LLM_API_KEY）；
//   contextWindow 默认 4096（schema + UI 都对齐：留空 = 4096 落表）；
//   LLM 字段集内每个 input 都有自己的 label（之前只有共享的 legend）。
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
  // v6.3.2: 改用 maxCompletionTokens 字段名（OpenAI 新 SDK 对齐）；表单层接受 number；
  //   '' 表示"用 core 默认 4096"——提单时 '' 变 null。
  maxCompletionTokens: z
    .union([z.literal(''), z.coerce.number().int().min(1).max(32000)])
    .default(''),
  // v6.4: context window 上限 2_000_000（与 core 端 zod 对齐）。
  //   UI 默认 4096：表单层接受 '' 视为 4096，提交时统一落 4096（不留 null）。
  contextWindow: z
    .union([z.literal(''), z.coerce.number().int().min(1).max(2_000_000)])
    .default(''),
  // v6.4: per-agent API key；空 = 回退到 env LLM_API_KEY。
  apiKey: z.string().max(512).default(''),
  enabledApi: z.boolean().default(false),
  systemPrompt: z.string().max(8192).default(''),
});

// v6.4: 全部 default 改成 4096（maxCompletionTokens 一直 4096；contextWindow 也 4096）；
//   apiKey 默认空字符串（表单态），提交时转 null。
//   移除 reasoningEffort（不再是 agent 持久化字段）。
const EMPTY: Omit<Agent, 'id' | 'createdAt' | 'updatedAt' | 'capabilities'> = {
  name: '',
  description: '',
  llmProvider: 'openai-compatible',
  baseUrl: '',
  model: '',
  maxCompletionTokens: 4096,
  contextWindow: 4096,
  apiKey: '',
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
          // v6.3.2: 后端若尚未升级到 v6.3.2，a.maxCompletionTokens 可能为 undefined；兜底 4096。
          maxCompletionTokens: a.maxCompletionTokens ?? 4096,
          // v6.4: 兜底 4096（schema 默认值；老 DB 行若为 null 也用 4096）。
          contextWindow: a.contextWindow ?? 4096,
          // v6.4: per-agent apiKey 兜底空字符串（= 用 env）。
          apiKey: a.apiKey ?? '',
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
    // maxCompletionTokens / contextWindow 表单态：number 走数字，'' 走 "用 core 默认"。
    //   提交前 candidate 已是 FormSchema 接受的形态（number 或 ''）。
    const parsed = FormSchema.safeParse(form);
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
        // v6.3.2: maxCompletionTokens '' 退到 null（core 端 4096 兜底）；数字直传。
        maxCompletionTokens:
          parsed.data.maxCompletionTokens === ''
            ? null
            : (parsed.data.maxCompletionTokens as number),
        // v6.4: contextWindow 留空统一落 4096（schema 默认）；不存 null。
        contextWindow:
          parsed.data.contextWindow === '' ? 4096 : (parsed.data.contextWindow as number),
        // v6.4: apiKey 留空转 null（= 用 env LLM_API_KEY）；非空 trim 后入库。
        apiKey: parsed.data.apiKey.trim() === '' ? null : parsed.data.apiKey.trim(),
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
                {/* v6.4: 每个 input 都有自己的 label（之前只有共享 legend，无障碍/可读性都不够） */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>
                    <label
                      htmlFor="agent-baseUrl"
                      style={{ fontSize: 12, color: 'var(--text-muted)' }}
                    >
                      {t('agentForm.field.baseUrl.label')} *
                    </label>
                    <input
                      id="agent-baseUrl"
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
                  </div>
                  <div>
                    <label
                      htmlFor="agent-model"
                      style={{ fontSize: 12, color: 'var(--text-muted)' }}
                    >
                      {t('agentForm.field.model.label')} *
                    </label>
                    <input
                      id="agent-model"
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
                  </div>
                  <div>
                    <label
                      htmlFor="agent-apiKey"
                      style={{ fontSize: 12, color: 'var(--text-muted)' }}
                    >
                      {t('agentForm.field.apiKey.label')}
                    </label>
                    <input
                      id="agent-apiKey"
                      type="password"
                      className="input"
                      value={form.apiKey ?? ''}
                      onChange={e => setForm({ ...form, apiKey: e.target.value })}
                      placeholder={t('agentForm.field.apiKey.placeholder')}
                      maxLength={512}
                      disabled={submitting}
                      autoComplete="off"
                      aria-label={t('agentForm.field.apiKey.label')}
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
                  {/* v6.3.2: maxCompletionTokens 字段名（OpenAI 新 SDK 对齐）+ 默认 4096 */}
                  <div>
                    <label
                      htmlFor="agent-maxCompletionTokens"
                      style={{ fontSize: 12, color: 'var(--text-muted)' }}
                    >
                      {t('agentForm.field.maxCompletionTokens.label')}
                    </label>
                    <input
                      id="agent-maxCompletionTokens"
                      type="number"
                      className="input"
                      value={
                        form.maxCompletionTokens === null ? '' : String(form.maxCompletionTokens)
                      }
                      onChange={e =>
                        setForm({
                          ...form,
                          maxCompletionTokens:
                            e.target.value === '' ? 4096 : Number(e.target.value),
                        })
                      }
                      placeholder={t('agentForm.field.maxCompletionTokens.placeholder')}
                      min={1}
                      max={32000}
                      disabled={submitting}
                      aria-label={t('agentForm.field.maxCompletionTokens.label')}
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
                  {/* v6.4: context window（Ollama num_ctx；其他 provider 静默忽略）留空 = 4096 落表 */}
                  <div>
                    <label
                      htmlFor="agent-contextWindow"
                      style={{ fontSize: 12, color: 'var(--text-muted)' }}
                    >
                      {t('agentForm.field.contextWindow.label')}
                    </label>
                    <input
                      id="agent-contextWindow"
                      type="number"
                      className="input"
                      value={form.contextWindow === null ? '' : String(form.contextWindow)}
                      onChange={e =>
                        setForm({
                          ...form,
                          contextWindow: e.target.value === '' ? 4096 : Number(e.target.value),
                        })
                      }
                      placeholder={t('agentForm.field.contextWindow.placeholder')}
                      min={1}
                      max={2_000_000}
                      disabled={submitting}
                      aria-label={t('agentForm.field.contextWindow.label')}
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
          options={{ mountEsc: false }}
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
