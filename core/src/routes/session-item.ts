// GET / DELETE /v1/sessions/{id}：跨 clientKey 可访问（一人多设备共享）。
import type { FastifyInstance } from 'fastify';
import { SessionsDAO, type SessionRow } from '../db/sessions.js';
import { HttpError } from '../errors.js';

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

export async function sessionItemRoutes(app: FastifyInstance) {
  const dao = (app as unknown as { sessions: SessionsDAO }).sessions;

  app.get('/v1/sessions/:id', async req => {
    const { id } = req.params as { id: string };
    const row = dao.get(id);
    if (!row) throw new HttpError(404, 'session_not_found');
    return { data: rowToSession(row), code: 0, message: 'ok' as const };
  });

  app.delete('/v1/sessions/:id', async req => {
    const { id } = req.params as { id: string };
    const row = dao.get(id);
    if (!row) throw new HttpError(404, 'session_not_found');
    dao.delete(id);
    return { data: null, code: 0, message: 'ok' as const };
  });
}
