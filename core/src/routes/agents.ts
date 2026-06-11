// /v1/agents 列表 + 新建。
// v1 走 registry 内存；v6.1 走 DB；v6.3.1 新增 contextWindow 字段；v6.3.2 新增 reasoningEffort 字段。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type AgentsDAO } from '../db/agents.js';
import { HttpError } from '../errors.js';
import type { AgentRow } from '../db/agents.js';

const CreateAgentBody = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  description: z.string().max(256).default(''),
  llm_provider: z.literal('openai-compatible').default('openai-compatible'),
  baseUrl: z.string().min(1).max(512),
  model: z.string().min(1).max(128),
  maxTokens: z.number().int().min(1).max(32000).nullable().default(null),
  // v6.3.1: context window 大小；与 maxTokens（per-response）区分。
  // 上限 2_000_000 覆盖 1M+ context window 模型。
  contextWindow: z.number().int().min(1).max(2_000_000).nullable().default(null),
  // v6.3.2: OpenAI o1/o3 思考强度；其他 provider 静默忽略。默认 'none'（不思考）。
  reasoningEffort: z
    .enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])
    .default('none')
    .optional(),
  enabledApi: z.boolean().default(false),
  systemPrompt: z.string().max(8192).default(''),
  capabilities: z.array(z.string()).default([]),
});

function rowToAgent(row: AgentRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    llmProvider: row.llm_provider,
    baseUrl: row.base_url,
    model: row.model,
    maxTokens: row.max_tokens,
    contextWindow: row.context_window,
    // v6.3.2: 回显 reasoningEffort（DB nullable；落表时若为 null 仍以 null 返回）。
    reasoningEffort: row.reasoning_effort,
    enabledApi: row.enabled_api === 1,
    systemPrompt: row.system_prompt,
    capabilities: JSON.parse(row.capabilities) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function agentRoutes(app: FastifyInstance) {
  const dao = (app as unknown as { agents: AgentsDAO }).agents;

  app.get('/v1/agents', async () => {
    const rows = dao.list();
    return { data: rows.map(rowToAgent), code: 0, message: 'ok' as const };
  });

  app.post('/v1/agents', async (req, _reply) => {
    const parsed = CreateAgentBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_body');
    }
    const now = new Date().toISOString();
    const row: AgentRow = {
      id: parsed.data.id,
      name: parsed.data.name,
      description: parsed.data.description,
      llm_provider: parsed.data.llm_provider,
      base_url: parsed.data.baseUrl,
      model: parsed.data.model,
      max_tokens: parsed.data.maxTokens,
      context_window: parsed.data.contextWindow,
      // v6.3.2: 落表 nullable 时仍存 null（不强制 'none'）；路由 + LLM 客户端有 default。
      reasoning_effort: parsed.data.reasoningEffort ?? 'none',
      enabled_api: parsed.data.enabledApi ? 1 : 0,
      system_prompt: parsed.data.systemPrompt,
      capabilities: JSON.stringify(parsed.data.capabilities),
      created_at: now,
      updated_at: now,
    };
    try {
      dao.insert(row);
    } catch (e) {
      if ((e as Error).message.includes('UNIQUE constraint failed')) {
        throw new HttpError(409, 'agent_name_conflict');
      }
      throw e;
    }
    return { data: rowToAgent(row), code: 0, message: 'ok' as const };
  });
}
