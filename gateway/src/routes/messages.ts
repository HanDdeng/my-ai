// gateway 透传 /v1/sessions/{id}/messages 到 core：2 端点（GET / POST）。
// 错误码透传：core 4xx/5xx 整包透传（status + data 字段）；gateway 网络层异常 → 502 upstream_error。
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ok, err } from '../response.js';
import type { CoreClient } from '../clients/core.js';

function getClientKey(req: FastifyRequest): string {
  if (!req.clientCtx) {
    throw new Error('clientCtx not set (auth middleware not run?)');
  }
  return req.clientCtx.id;
}

export async function messagesRoutes(app: FastifyInstance, core: CoreClient) {
  // GET /v1/sessions/{id}/messages
  app.get<{ Params: { id: string } }>('/v1/sessions/:id/messages', async (req, reply) => {
    const ck = getClientKey(req);
    try {
      const { status, data } = await core.listMessages(ck, req.params.id);
      return reply.code(status).send(ok(data));
    } catch (e) {
      req.log.error({ err: e, sessionId: req.params.id }, 'listMessages failed');
      return reply.code(502).send(err(502, 'upstream_error'));
    }
  });

  // POST /v1/sessions/{id}/messages（同步 chat，取代 v1 /v1/chat）
  app.post<{ Params: { id: string } }>('/v1/sessions/:id/messages', async (req, reply) => {
    const ck = getClientKey(req);
    try {
      const { status, data } = await core.postMessage(ck, req.params.id, req.body);
      return reply.code(status).send(ok(data));
    } catch (e) {
      req.log.error({ err: e, sessionId: req.params.id }, 'postMessage failed');
      return reply.code(502).send(err(502, 'upstream_error'));
    }
  });
}
