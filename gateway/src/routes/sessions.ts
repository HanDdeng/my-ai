// gateway 透传 /v1/sessions 到 core：3 端点（POST / GET-id / DELETE）。
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

export async function sessionRoutes(app: FastifyInstance, core: CoreClient) {
  // POST /v1/sessions
  app.post('/v1/sessions', async (req, reply) => {
    const ck = getClientKey(req);
    try {
      const { status, data } = await core.createSession(ck, req.body);
      return reply.code(status).send(ok(data));
    } catch (e) {
      req.log.error({ err: e }, 'createSession failed');
      return reply.code(502).send(err(502, 'upstream_error'));
    }
  });

  // GET /v1/sessions/{id}
  app.get<{ Params: { id: string } }>('/v1/sessions/:id', async (req, reply) => {
    const ck = getClientKey(req);
    try {
      const { status, data } = await core.getSession(ck, req.params.id);
      return reply.code(status).send(ok(data));
    } catch (e) {
      req.log.error({ err: e, id: req.params.id }, 'getSession failed');
      return reply.code(502).send(err(502, 'upstream_error'));
    }
  });

  // DELETE /v1/sessions/{id}
  app.delete<{ Params: { id: string } }>('/v1/sessions/:id', async (req, reply) => {
    const ck = getClientKey(req);
    try {
      const { status, data } = await core.deleteSession(ck, req.params.id);
      return reply.code(status).send(ok(data));
    } catch (e) {
      req.log.error({ err: e, id: req.params.id }, 'deleteSession failed');
      return reply.code(502).send(err(502, 'upstream_error'));
    }
  });
}
