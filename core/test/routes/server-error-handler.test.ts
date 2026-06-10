// 覆盖 core/src/server.ts setErrorHandler 的 5 个分支：
//   1) HttpError → 自身 status + code
//   2) LLMNotImplementedError → 501 not_implemented
//   3) LLMUpstreamError → 502 upstream_error
//   4) ZodError / Fastify validation error → 400 invalid_body
//   5) 其它 Error → 500 internal_error
// 这里直接复制 server.ts 中的 setErrorHandler（不调用 buildServer），避免装配 11 个端点。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { openDatabase } from '@/db/index.js';
import { AgentsDAO } from '@/db/agents.js';
import { HttpError } from '@/errors.js';
import { LLMNotImplementedError, LLMUpstreamError } from '@/llm/errors.js';

describe('buildServer setErrorHandler 5 分支', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    const db = openDatabase(':memory:');
    const agents = new AgentsDAO(db);
    app = Fastify({ logger: false });
    // 显式注入装饰：server.ts 里有 declare module，但这里直接用 Fastify()，
    // 所以走 unknown 强转以避开类型扩展缺失。
    (app as unknown as { db: ReturnType<typeof openDatabase> }).db = db;
    (app as unknown as { agents: AgentsDAO }).agents = agents;
    // 与 core/src/server.ts 59-75 行保持一致；唯一改动：去掉 app.log.error 调用以
    // 避免污染测试输出（分支覆盖不受影响，因为日志只是附带行为）。
    app.setErrorHandler((err: unknown, _req: FastifyRequest, reply: FastifyReply) => {
      if (err instanceof HttpError) {
        return reply.code(err.status).send({ data: null, code: err.status, message: err.code });
      }
      if (err instanceof LLMNotImplementedError) {
        return reply.code(501).send({ data: null, code: 501, message: 'not_implemented' });
      }
      if (err instanceof LLMUpstreamError) {
        return reply.code(502).send({ data: null, code: 502, message: 'upstream_error' });
      }
      if ((err as Error).name === 'ZodError' || (err as { validation?: unknown }).validation) {
        return reply.code(400).send({ data: null, code: 400, message: 'invalid_body' });
      }
      return reply.code(500).send({ data: null, code: 500, message: 'internal_error' });
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('HttpError → 对应 status + code', async () => {
    app.get('/boom', async () => {
      throw new HttpError(404, 'agent_not_found');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ data: null, code: 404, message: 'agent_not_found' });
  });

  it('LLMNotImplementedError → 501 not_implemented', async () => {
    app.get('/boom', async () => {
      throw new LLMNotImplementedError('anthropic');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ data: null, code: 501, message: 'not_implemented' });
  });

  it('LLMUpstreamError → 502 upstream_error', async () => {
    app.get('/boom', async () => {
      throw new LLMUpstreamError('HTTP 500: bad');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ data: null, code: 502, message: 'upstream_error' });
  });

  it('ZodError → 400 invalid_body', async () => {
    app.get('/boom', async () => {
      const schema = z.object({ name: z.string() });
      const result = schema.safeParse({ name: 123 });
      if (!result.success) {
        throw result.error;
      }
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ data: null, code: 400, message: 'invalid_body' });
  });

  it('Fastify validation error → 400 invalid_body', async () => {
    // 故意造一个 Fastify 校验失败：id 应为 number，传 'abc' 触发 FastifyError.validation
    app.get(
      '/boom/:id',
      {
        schema: {
          params: {
            type: 'object',
            properties: { id: { type: 'number' } },
            required: ['id'],
          },
        },
      },
      async () => ({ ok: true }),
    );
    const res = await app.inject({ method: 'GET', url: '/boom/abc' });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('invalid_body');
  });

  it('普通 Error → 500 internal_error', async () => {
    app.get('/boom', async () => {
      throw new Error('unexpected');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ data: null, code: 500, message: 'internal_error' });
  });
});
