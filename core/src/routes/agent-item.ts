// GET / PATCH / DELETE /v1/agents/{id}。
// CASCADE 由 schema.sql 的 ON DELETE CASCADE 约束 + PRAGMA foreign_keys=ON 处理，
// 路由层不直接调 SessionsDAO。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AgentsDAO, type AgentRow } from '../db/agents.js';
import { HttpError } from '../errors.js';

const PatchAgentBody = z
  .object({
    name: z.string().min(1).max(64).optional(),
    description: z.string().max(256).optional(),
    baseUrl: z.string().min(1).max(512).optional(),
    model: z.string().min(1).max(128).optional(),
    maxTokens: z.number().int().min(1).max(32000).nullable().optional(),
    enabledApi: z.boolean().optional(),
    systemPrompt: z.string().max(8192).optional(),
    capabilities: z.array(z.string()).optional(),
  })
  .refine(o => Object.keys(o).length > 0, { message: 'at least one field required' });

function rowToAgent(row: AgentRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    llmProvider: row.llm_provider,
    baseUrl: row.base_url,
    model: row.model,
    maxTokens: row.max_tokens,
    enabledApi: row.enabled_api === 1,
    systemPrompt: row.system_prompt,
    capabilities: JSON.parse(row.capabilities) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function agentItemRoutes(app: FastifyInstance) {
  const dao = (app as unknown as { agents: AgentsDAO }).agents;

  app.get('/v1/agents/:id', async req => {
    const { id } = req.params as { id: string };
    const row = dao.get(id);
    if (!row) throw new HttpError(404, 'agent_not_found');
    return { data: rowToAgent(row), code: 0, message: 'ok' as const };
  });

  app.patch('/v1/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = dao.get(id);
    if (!existing) throw new HttpError(404, 'agent_not_found');

    const parsed = PatchAgentBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_body');
    }

    const fields: Partial<AgentRow> = { updated_at: new Date().toISOString() };
    if (parsed.data.name !== undefined) fields.name = parsed.data.name;
    if (parsed.data.description !== undefined) fields.description = parsed.data.description;
    if (parsed.data.baseUrl !== undefined) fields.base_url = parsed.data.baseUrl;
    if (parsed.data.model !== undefined) fields.model = parsed.data.model;
    if (parsed.data.maxTokens !== undefined) fields.max_tokens = parsed.data.maxTokens;
    if (parsed.data.enabledApi !== undefined) fields.enabled_api = parsed.data.enabledApi ? 1 : 0;
    if (parsed.data.systemPrompt !== undefined) fields.system_prompt = parsed.data.systemPrompt;
    if (parsed.data.capabilities !== undefined) {
      fields.capabilities = JSON.stringify(parsed.data.capabilities);
    }

    try {
      dao.update(id, fields);
    } catch (e) {
      if ((e as Error).message.includes('UNIQUE constraint failed')) {
        throw new HttpError(409, 'agent_name_conflict');
      }
      throw e;
    }

    const updated = dao.get(id);
    if (!updated) throw new HttpError(404, 'agent_not_found');
    return { data: rowToAgent(updated), code: 0, message: 'ok' as const };
  });

  app.delete('/v1/agents/:id', async req => {
    const { id } = req.params as { id: string };
    const existing = dao.get(id);
    if (!existing) throw new HttpError(404, 'agent_not_found');
    dao.delete(id);
    return { data: null, code: 0, message: 'ok' as const };
  });
}
