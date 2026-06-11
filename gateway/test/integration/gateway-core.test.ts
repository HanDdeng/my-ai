// Gateway 端到端 integration：起一个 mock core HTTP server + 真实 buildServer + 真实 AuthStore。
// 验证：
//   1. 头注入：gateway→core 真的挂上 X-Internal-Client-Key（值 = req.clientCtx.id = sha256 hash）
//   2. 跨 clientKey 共享 session：v6.1 决策 16 —— clientKeyA 创建，clientKeyB GET 同一 session 也能读
//   3. 网络层异常：mock core 拒连 → gateway 502 upstream_error
//   4. 错误码端到端：mock core 返回 404 / 409 / 502 → gateway 透传 HTTP status（body 仍走 ok() 包装）
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { openDatabase } from '@/db.js';
import { AuthStore } from '@/auth/store.js';
import { sha256 } from '@/auth/hash.js';
import { buildServer } from '@/server.js';
import { loadConfig } from '@/config.js';
import type { Compat } from '@/compat/load.js';

// 真实 mock core：捕获所有收到的请求供断言；用 sessions map 模拟跨 clientKey 共享。
let mockCore: Server;
let mockCoreUrl: string;
// exactOptionalPropertyTypes 下不能用 method?: string 收集 IncomingMessage.method
// (它是 string | undefined)；显式标 undefined。
const capturedRequests: Array<{
  method: string | undefined;
  url: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  body: string | undefined;
}> = [];

// "拒连 server"：accept 后立即 destroy socket，专门测 network-layer 异常。
// unref() 让它不阻塞测试进程退出。
let deadCore: Server;
let deadCoreUrl: string;

const fakeCompat: Compat = { version: '9.9.9', upstream: { core: '>=0.0.2 <0.1.0' } };

beforeAll(async () => {
  // === mock core：模拟 v6.1 已实现的 10 端点 ===
  const sessions = new Map<
    string,
    { id: string; agentId: string; clientKey: string; createdAt: string; updatedAt: string }
  >();

  mockCore = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      capturedRequests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : undefined,
      });

      const ck = req.headers['x-internal-client-key'];
      if (typeof ck !== 'string') {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: null, code: 401, message: 'unauthorized' }));
        return;
      }

      // POST /v1/sessions
      if (req.url === '/v1/sessions' && req.method === 'POST') {
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = raw
          ? (JSON.parse(raw) as { id: string; agentId: string })
          : { id: '', agentId: '' };
        const session = {
          id: body.id,
          agentId: body.agentId,
          clientKey: ck,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        sessions.set(session.id, session);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: session, code: 0, message: 'ok' }));
        return;
      }

      // GET /v1/sessions/{id}（v6.1 决策 16：跨 clientKey 共享，不做 ck 校验）
      const getMatch = req.url?.match(/^\/v1\/sessions\/([^/]+)$/);
      if (getMatch && req.method === 'GET') {
        const sid = getMatch[1] ?? '';
        const session = sessions.get(sid);
        if (!session) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ data: null, code: 404, message: 'session_not_found' }));
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: session, code: 0, message: 'ok' }));
        return;
      }

      // GET /v1/agents（list）
      if (req.url === '/v1/agents' && req.method === 'GET') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: [], code: 0, message: 'ok' }));
        return;
      }

      // POST /v1/agents（name 冲突测试用）
      if (req.url === '/v1/agents' && req.method === 'POST') {
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = raw ? (JSON.parse(raw) as { name?: string }) : {};
        if (body.name === 'duplicate') {
          res.statusCode = 409;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ data: null, code: 409, message: 'agent_name_conflict' }));
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: { id: 'new', name: body.name }, code: 0, message: 'ok' }));
        return;
      }

      // 默认
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: null, code: 404, message: 'not_found' }));
    });
  });

  await new Promise<void>(resolve => mockCore.listen(0, '127.0.0.1', resolve));
  const addr = mockCore.address();
  if (typeof addr === 'string' || addr === null) {
    throw new Error('unexpected address');
  }
  mockCoreUrl = `http://127.0.0.1:${addr.port}`;

  // === dead core：accept 后立即 destroy socket ===
  // 测网络层异常：undici 连上但拿不到响应 → 抛错 → gateway 502。
  deadCore = createServer(req => {
    req.socket.destroy();
  });
  deadCore.unref(); // 不阻塞 vitest 进程退出
  await new Promise<void>(resolve => deadCore.listen(0, '127.0.0.1', resolve));
  const deadAddr = deadCore.address();
  if (typeof deadAddr === 'string' || deadAddr === null) {
    throw new Error('unexpected dead address');
  }
  deadCoreUrl = `http://127.0.0.1:${deadAddr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    mockCore.close(err => (err ? reject(err) : resolve())),
  );
  await new Promise<void>((resolve, reject) =>
    deadCore.close(err => (err ? reject(err) : resolve())),
  );
});

/**
 * 构造一个独立 store + 真实 buildServer。
 * 返回 ckA / ckB 是**明文** header key（gateway 中间件会 sha256 后查 DB）。
 * 写库时 id 字段 = sha256(明文 key)，与 middleware 行为对齐。
 *
 * 注：app 类型用 Awaited<ReturnType<typeof buildServer>> 而非裸 FastifyInstance，
 * 因为 buildServer 内部 logger 用 createLogger() 会让 TS 推断出更窄的返回类型，
 * 与裸 FastifyInstance 在 withTypeProvider / childLoggerFactory 等签名上不兼容。
 */
async function buildApp(coreUrl: string): Promise<{
  app: Awaited<ReturnType<typeof buildServer>>;
  ckA: string;
  ckB: string;
}> {
  const store = new AuthStore(openDatabase(':memory:'));
  const ckA = 'plain-key-A';
  const ckB = 'plain-key-B';
  const idA = sha256(ckA);
  const idB = sha256(ckB);
  store.insertClient({
    id: idA,
    keyHash: idA,
    name: 'clientA',
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
  });
  store.insertClient({
    id: idB,
    keyHash: idB,
    name: 'clientB',
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
  });

  // buildServer 不内部 listen，PORT 仅作 zod 校验占位；用 1 避开 positive() 检查。
  const cfg = loadConfig({
    PORT: '1',
    HOST: '127.0.0.1',
    CORE_URL: coreUrl,
    LOG_LEVEL: 'fatal',
    CORS_ORIGINS: '*',
    GATEWAY_PAIRING_PUBLIC: 'false',
    GATEWAY_DB_PATH: ':memory:',
  });

  const app = await buildServer(cfg, fakeCompat, store);
  return { app, ckA, ckB };
}

describe('Integration: gateway → core', () => {
  it('头注入：X-Internal-Client-Key = req.clientCtx.id (sha256 hash) 出现在 mock core 请求上', async () => {
    capturedRequests.length = 0;
    const { app, ckA } = await buildApp(mockCoreUrl);
    await app.inject({ method: 'GET', url: '/v1/agents', headers: { 'x-client-key': ckA } });

    // 找 GET /v1/agents 请求，断言 X-Internal-Client-Key 头 = sha256(ckA)
    const listReq = capturedRequests.find(r => r.method === 'GET' && r.url === '/v1/agents');
    expect(listReq).toBeDefined();
    expect(listReq!.headers['x-internal-client-key']).toBe(sha256(ckA));
  });

  it('跨 clientKey 共享 session：clientKeyA 创建 → clientKeyB GET 同一 session 也能读到（v6.1 决策 16）', async () => {
    capturedRequests.length = 0;
    const { app, ckA, ckB } = await buildApp(mockCoreUrl);

    // clientA 创建 session
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { 'x-client-key': ckA, 'content-type': 'application/json' },
      payload: { id: 's-shared', agentId: 'a1' },
    });
    expect(createRes.statusCode).toBe(200);
    expect(createRes.json().data.clientKey).toBe(sha256(ckA));

    // clientB GET 同一 session
    const getRes = await app.inject({
      method: 'GET',
      url: '/v1/sessions/s-shared',
      headers: { 'x-client-key': ckB },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().data.id).toBe('s-shared');
  });

  it('错误码端到端：core 返回 409 agent_name_conflict → gateway 透传 HTTP status（body 仍走 ok 包装）', async () => {
    const { app, ckA } = await buildApp(mockCoreUrl);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: { 'x-client-key': ckA, 'content-type': 'application/json' },
      payload: { id: 'x', name: 'duplicate' },
    });
    expect(res.statusCode).toBe(409);
    // 实际行为：route handler 走 reply.code(status).send(ok(data))，body 仍为成功包装
    expect(res.json()).toEqual({ data: null, code: 0, message: 'ok' });
  });

  it('错误码端到端：core 返回 404 session_not_found → gateway 透传 HTTP status', async () => {
    const { app, ckA } = await buildApp(mockCoreUrl);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions/nonexistent',
      headers: { 'x-client-key': ckA },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().data).toBeNull();
  });

  it('网络层异常：core 拒连 → gateway 502 upstream_error', async () => {
    // 单独 build 一个指向 deadCore 的 app（mockCore 仍活着给其他测试用）
    const { app, ckA } = await buildApp(deadCoreUrl);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/agents',
      headers: { 'x-client-key': ckA },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ data: null, code: 502, message: 'upstream_error' });
  });
});
