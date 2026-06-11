// gateway 透传 /v1/agents 到 core；v3 起走新响应包装，v6.2 扩 4 端点（POST/GET-id/PATCH/DELETE）。
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

export async function agentRoutes(app: FastifyInstance, core: CoreClient) {
  // GET /v1/agents（v3 现状路径；v6.2 改造走 call()）
  app.get('/v1/agents', async (req, reply) => {
    const ck = getClientKey(req);
    try {
      const { status, data } = await core.listAgents(ck);
      return reply.code(status).send(ok(data));
    } catch (e) {
      req.log.error({ err: e }, 'listAgents failed');
      return reply.code(502).send(err(502, 'upstream_error'));
    }
  });

  // POST /v1/agents
  app.post('/v1/agents', async (req, reply) => {
    const ck = getClientKey(req);
    try {
      const { status, data } = await core.createAgent(ck, req.body);
      return reply.code(status).send(ok(data));
    } catch (e) {
      req.log.error({ err: e }, 'createAgent failed');
      return reply.code(502).send(err(502, 'upstream_error'));
    }
  });

  // GET /v1/agents/{id}
  app.get<{ Params: { id: string } }>('/v1/agents/:id', async (req, reply) => {
    const ck = getClientKey(req);
    try {
      const { status, data } = await core.getAgent(ck, req.params.id);
      return reply.code(status).send(ok(data));
    } catch (e) {
      req.log.error({ err: e, id: req.params.id }, 'getAgent failed');
      return reply.code(502).send(err(502, 'upstream_error'));
    }
  });

  // PATCH /v1/agents/{id}
  app.patch<{ Params: { id: string } }>('/v1/agents/:id', async (req, reply) => {
    const ck = getClientKey(req);
    try {
      const { status, data } = await core.updateAgent(ck, req.params.id, req.body);
      return reply.code(status).send(ok(data));
    } catch (e) {
      req.log.error({ err: e, id: req.params.id }, 'updateAgent failed');
      return reply.code(502).send(err(502, 'upstream_error'));
    }
  });

  // DELETE /v1/agents/{id}
  app.delete<{ Params: { id: string } }>('/v1/agents/:id', async (req, reply) => {
    const ck = getClientKey(req);
    try {
      const { status, data } = await core.deleteAgent(ck, req.params.id);
      return reply.code(status).send(ok(data));
    } catch (e) {
      req.log.error({ err: e, id: req.params.id }, 'deleteAgent failed');
      return reply.code(502).send(err(502, 'upstream_error'));
    }
  });
}
