import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { internalClientKeyHook } from '@/hooks/internal-client-key.js';
import { HttpError } from '@/errors.js';

describe('X-Internal-Client-Key hook', () => {
  it('有 header → req.internalClientKey 设值；handler 调通', async () => {
    const app = Fastify();
    await app.register(internalClientKeyHook);
    app.get('/probe', async req => {
      return { ck: (req as { internalClientKey?: string }).internalClientKey };
    });
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { 'x-internal-client-key': 'client-abc' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ck: 'client-abc' });
    await app.close();
  });

  it('缺 header → setErrorHandler 捕获 HttpError → 401 unauthorized', async () => {
    const app = Fastify();
    app.setErrorHandler((err, _req, reply) => {
      if (err instanceof HttpError) {
        return reply.code(err.status).send({ data: null, code: err.status, message: err.code });
      }
      return reply.code(500).send({ data: null, code: 500, message: 'internal_error' });
    });
    await app.register(internalClientKeyHook);
    app.get('/probe', async () => ({ ok: true }));

    const res = await app.inject({ method: 'GET', url: '/probe' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ data: null, code: 401, message: 'unauthorized' });
    await app.close();
  });

  it('/health 是 public path → 缺 header 也 200', async () => {
    const app = Fastify();
    await app.register(internalClientKeyHook);
    app.get('/health', async () => ({ ok: true }));

    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
