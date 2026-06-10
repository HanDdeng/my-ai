// POST /v1/sessions：开新 session。clientKey 从 X-Internal-Client-Key 取（hook 已设）。
// 写 sessions.client_key 作为创建者审计字段（spec §5.2 一人多设备场景）。
// v6.1 改造：sessions 入 DB；DTO 行（snake_case）→ API 响应（camelCase）经 rowToSession 转。
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AgentsDAO } from '../db/agents.js';
import { SessionsDAO, type SessionRow } from '../db/sessions.js';
import { HttpError } from '../errors.js';

const CreateSessionBody = z.object({
  id: z.string().min(1).max(64),
  agentId: z.string().min(1).max(64),
});

function rowToSession(row: SessionRow) {
  return {
    id: row.id,
    agentId: row.agent_id,
    clientKey: row.client_key,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function sessionRoutes(app: FastifyInstance) {
  const agentsDao = (app as unknown as { agents: AgentsDAO }).agents;
  const sessionsDao = (app as unknown as { sessions: SessionsDAO }).sessions;

  app.post('/v1/sessions', async (req: FastifyRequest) => {
    const parsed = CreateSessionBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'invalid_body');

    // 检查 agent 存在
    if (!agentsDao.get(parsed.data.agentId)) {
      throw new HttpError(404, 'agent_not_found');
    }

    // clientKey 由 hook 写入
    const clientKey = req.internalClientKey;
    if (!clientKey) throw new HttpError(401, 'unauthorized');

    const now = new Date().toISOString();
    const row: SessionRow = {
      id: parsed.data.id,
      agent_id: parsed.data.agentId,
      client_key: clientKey,
      title: '',
      created_at: now,
      updated_at: now,
    };
    sessionsDao.insert(row);
    return { data: rowToSession(row), code: 0, message: 'ok' as const };
  });
}
