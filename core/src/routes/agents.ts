// /v1/agents 列表 + 新建。
// v1 走 registry 内存；v6.1 走 DB；v6.3.1 新增 contextWindow 字段；v6.3.2 新增 reasoningEffort 字段；
// v6.4 新增 apiKey 字段（per-agent 凭据）。
// v6.5: 解除 maxTokens ≤32000 上限（Issue #4）；仅保留 ≥1。
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
  maxTokens: z.number().int().min(1).nullable().default(null),
  // v6.3.1: context window 大小；与 maxTokens（per-response）区分。
  // 上限 2_000_000 覆盖 1M+ context window 模型。
  // v6.4: nullable + 默认 4096。null 视同"用默认"（路由层 transform 成 4096）。
  contextWindow: z.number().int().min(1).max(2_000_000).nullable().default(4096),
  // v6.4: 取消 reasoningEffort 字段（不再持久化；调用时由消息接口传参，硬编码 'none'）。
  // v6.4: per-agent API key；nullable → 回退到 env LLM_API_KEY。
  apiKey: z.string().min(1).max(512).nullable().default(null),
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
    // v6.4: 回显 apiKey（DB 可能为 null）。reasoningEffort 字段从契约里移除（不再持久化）。
    apiKey: row.api_key,
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
      // v6.4: null 视同"用默认"，统一落 4096。
      context_window: parsed.data.contextWindow ?? 4096,
      api_key: parsed.data.apiKey,
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
