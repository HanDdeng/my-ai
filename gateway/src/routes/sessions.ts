// gateway 透传 /v1/sessions 到 core：3 端点（POST / GET-id / DELETE）。
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

export async function sessionRoutes(app: FastifyInstance, core: CoreClient) {
  // POST /v1/sessions
  app.post('/v1/sessions', async (req, reply) => {
    const ck = getClientKey(req);
    try {
      const { status, body } = await core.createSession(ck, req.body);
      const payload = status < 400 ? ok((body as { data?: unknown })?.data ?? null) : body;
      return reply.code(status).send(payload);
    } catch (e) {
      req.log.error({ err: e }, 'createSession failed');
      return reply.code(502).send(err(502, 'upstream_error'));
    }
  });

  // GET /v1/sessions/{id}
  app.get<{ Params: { id: string } }>('/v1/sessions/:id', async (req, reply) => {
    const ck = getClientKey(req);
    try {
      const { status, body } = await core.getSession(ck, req.params.id);
      const payload = status < 400 ? ok((body as { data?: unknown })?.data ?? null) : body;
      return reply.code(status).send(payload);
    } catch (e) {
      req.log.error({ err: e, id: req.params.id }, 'getSession failed');
      return reply.code(502).send(err(502, 'upstream_error'));
    }
  });

  // DELETE /v1/sessions/{id}
  app.delete<{ Params: { id: string } }>('/v1/sessions/:id', async (req, reply) => {
    const ck = getClientKey(req);
    try {
      const { status, body } = await core.deleteSession(ck, req.params.id);
      const payload = status < 400 ? ok((body as { data?: unknown })?.data ?? null) : body;
      return reply.code(status).send(payload);
    } catch (e) {
      req.log.error({ err: e, id: req.params.id }, 'deleteSession failed');
      return reply.code(502).send(err(502, 'upstream_error'));
    }
  });
}
