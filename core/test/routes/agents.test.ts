import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
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
    app.setErrorHandler((err: unknown, _req: FastifyRequest, reply: FastifyReply) => {
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
    await app.register(async (i: FastifyInstance) => {
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
        method: 'POST',
        url: '/v1/agents',
        payload: {
          id: 'a-1',
          name: 'Echo',
          baseUrl: 'http://localhost:11434/v1',
          model: 'qwen2.5:7b',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.code).toBe(0);
      expect(body.data.name).toBe('Echo');
      // v6.4: 留空 → 4096（schema 默认，不再 null）
      expect(body.data.contextWindow).toBe(4096);
      // 验证真持久化
      const got = app.agents.get('a-1');
      expect(got?.name).toBe('Echo');
      expect(got?.context_window).toBe(4096);
    });

    it('v6.3.1: 传 contextWindow → 持久化 + 回显', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/agents',
        payload: {
          id: 'a-2',
          name: 'Qwen',
          baseUrl: 'http://localhost:11434/v1',
          model: 'qwen3.5:4b',
          contextWindow: 65536,
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.contextWindow).toBe(65536);
      expect(app.agents.get('a-2')?.context_window).toBe(65536);
    });

    it('v6.3.1: contextWindow 越界 > 2_000_000 → 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/agents',
        payload: {
          id: 'a-3',
          name: 'Big',
          baseUrl: 'http://x/v1',
          model: 'm',
          contextWindow: 2_000_001,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('v6.3.1: contextWindow 显式 = null 也被 zod 拒（schema 不接受 null，落到默认 4096）', async () => {
      // v6.4 修复：contextWindow 不再 nullable；显式 null 走 zod default 4096。
      const res = await app.inject({
        method: 'POST',
        url: '/v1/agents',
        payload: {
          id: 'a-4',
          name: 'Null',
          baseUrl: 'http://x/v1',
          model: 'm',
          contextWindow: null,
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.contextWindow).toBe(4096);
    });

    it('v6.4: 不传 apiKey → null 落表 + 回显', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/agents',
        payload: { id: 'a-5', name: 'NoKey', baseUrl: 'http://x/v1', model: 'm' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.apiKey).toBeNull();
      expect(app.agents.get('a-5')?.api_key).toBeNull();
    });

    it('v6.4: 传 apiKey → 持久化 + 回显', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/agents',
        payload: {
          id: 'a-6',
          name: 'HasKey',
          baseUrl: 'http://x/v1',
          model: 'm',
          apiKey: 'sk-test-123',
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.apiKey).toBe('sk-test-123');
      expect(app.agents.get('a-6')?.api_key).toBe('sk-test-123');
    });

    it('v6.4: 传 reasoningEffort（已废弃字段）→ zod 静默忽略（200）', async () => {
      // v6.4: reasoningEffort 不再是 agent body 字段（改由消息接口传）。
      // zod 默认是 strip 模式（未知字段静默忽略），不返回 400。
      const res = await app.inject({
        method: 'POST',
        url: '/v1/agents',
        payload: {
          id: 'a-7',
          name: 'OldEffort',
          baseUrl: 'http://x/v1',
          model: 'm',
          reasoningEffort: 'bogus',
        },
      });
      expect(res.statusCode).toBe(200);
      // 回显里不应有 reasoningEffort 字段
      expect(res.json().data).not.toHaveProperty('reasoningEffort');
    });

    it('缺必填字段 → 400 invalid_body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/agents',
        payload: { name: 'Echo' }, // 缺 baseUrl/model/id
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe('invalid_body');
    });

    it('name 重复 → 409 agent_name_conflict', async () => {
      await app.inject({
        method: 'POST',
        url: '/v1/agents',
        payload: { id: 'a-1', name: 'Echo', baseUrl: 'http://x/v1', model: 'm' },
      });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/agents',
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
        method: 'POST',
        url: '/v1/agents',
        payload: { id: 'a-1', name: 'Echo', baseUrl: 'http://x/v1', model: 'm' },
      });
      const res = await app.inject({ method: 'GET', url: '/v1/agents' });
      const body = res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('Echo');
    });
  });
});
