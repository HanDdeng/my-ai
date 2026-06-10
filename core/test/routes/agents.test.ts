import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { openDatabase } from '@/db/index.js';
import { AgentsDAO } from '@/db/agents.js';
import { agentRoutes } from '@/routes/agents.js';
import { HttpError } from '@/errors.js';

describe('routes /v1/agents', () => {
  let dir: string;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'core-routes-'));
    const db = openDatabase(':memory:');
    app = Fastify();
    app.setErrorHandler((err, _req, reply) => {
      if (err instanceof HttpError) {
        return reply.code(err.status).send({ data: null, code: err.status, message: err.code });
      }
      if ((err as Error).name === 'ZodError') {
        return reply.code(400).send({ data: null, code: 400, message: 'invalid_body' });
      }
      return reply.code(500).send({ data: null, code: 500, message: 'internal_error' });
    });
    app.decorate('db', db);
    app.decorate('agents', new AgentsDAO(db));
    await app.register(async i => {
      await agentRoutes(i);
    });
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('POST /v1/agents', () => {
    it('合法 body → 200 + 持久化', async () => {
      const res = await app.inject({
        method: 'POST', url: '/v1/agents',
        payload: {
          id: 'a-1', name: 'Echo', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.code).toBe(0);
      expect(body.data.name).toBe('Echo');
      // 验证真持久化
      const got = app.agents.get('a-1');
      expect(got?.name).toBe('Echo');
    });

    it('缺必填字段 → 400 invalid_body', async () => {
      const res = await app.inject({
        method: 'POST', url: '/v1/agents', payload: { name: 'Echo' }, // 缺 baseUrl/model/id
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe('invalid_body');
    });

    it('name 重复 → 409 agent_name_conflict', async () => {
      await app.inject({
        method: 'POST', url: '/v1/agents',
        payload: { id: 'a-1', name: 'Echo', baseUrl: 'http://x/v1', model: 'm' },
      });
      const res = await app.inject({
        method: 'POST', url: '/v1/agents',
        payload: { id: 'a-2', name: 'Echo', baseUrl: 'http://x/v1', model: 'm' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().message).toBe('agent_name_conflict');
    });
  });

  describe('GET /v1/agents', () => {
    it('空 → 200 + []', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/agents' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ data: [], code: 0, message: 'ok' });
    });

    it('有 agent → 列出', async () => {
      await app.inject({
        method: 'POST', url: '/v1/agents',
        payload: { id: 'a-1', name: 'Echo', baseUrl: 'http://x/v1', model: 'm' },
      });
      const res = await app.inject({ method: 'GET', url: '/v1/agents' });
      const body = res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('Echo');
    });
  });
});
