// gateway 透传 /v1/sessions/{id}/messages 到 core：2 端点（GET / POST）。
// v6.2 (Option B) 行为：
//   - 2xx：core 整包 {data, code: 0, message: 'ok'} → 解出 .data 再走 ok() 包装。
//   - 4xx/5xx：core 整包 {data, code: 4xx/5xx, message: 'xxx'} → 真透传。
//   - gateway 网络层异常：502 upstream_error。
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
      const { status, body } = await core.listMessages(ck, req.params.id);
      const payload = status < 400 ? ok((body as { data?: unknown })?.data ?? null) : body;
      return reply.code(status).send(payload);
    } catch (e) {
      req.log.error({ err: e, sessionId: req.params.id }, 'listMessages failed');
      return reply.code(502).send(err(502, 'upstream_error'));
    }
  });

  // POST /v1/sessions/{id}/messages（同步 chat，取代 v1 /v1/chat）
  app.post<{ Params: { id: string } }>('/v1/sessions/:id/messages', async (req, reply) => {
    const ck = getClientKey(req);
    try {
      const { status, body } = await core.postMessage(ck, req.params.id, req.body);
      const payload = status < 400 ? ok((body as { data?: unknown })?.data ?? null) : body;
      return reply.code(status).send(payload);
    } catch (e) {
      req.log.error({ err: e, sessionId: req.params.id }, 'postMessage failed');
      return reply.code(502).send(err(502, 'upstream_error'));
    }
  });
}
