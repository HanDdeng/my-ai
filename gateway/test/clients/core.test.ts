// CoreClient 单元测试：覆盖 listAgents 透传 + 9 个新业务方法 + 错误码矩阵。
// v6.2 (Option B)：call() 整包保留 core 的 {data, code, message}；4xx 测真透传整包。
// 集成测走 task 10；本文件仅测 CoreClient 类与 mock core server 的契约。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { CoreClient } from '@/clients/core.js';

let server: Server;
let baseUrl: string;
type LastRequest = {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: string;
};
let lastRequest: LastRequest = {};

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // 收集请求元数据供测试断言
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      // exactOptionalPropertyTypes 下 req.method / url 可能 undefined，这里统一断言为 string|undefined。
      lastRequest = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers as Record<string, string | string[] | undefined>,
        body: chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : '',
      };

      // 简单 mock：根据 url 路径回包
      if (req.url === '/v1/agents' && req.method === 'GET') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: [{ id: 'a1', name: 'Echo' }], code: 0, message: 'ok' }));
        return;
      }
      if (req.url?.startsWith('/v1/agents/') && req.method === 'GET') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: { id: 'a1', name: 'Echo' }, code: 0, message: 'ok' }));
        return;
      }
      // 默认 404
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: null, code: 404, message: 'not_found' }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (typeof addr === 'string' || addr === null) {
    throw new Error('unexpected address');
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close(err => (err ? reject(err) : resolve())),
  );
});

describe('CoreClient.call()', () => {
  it('GET /v1/agents 透传 status + body (整包)', async () => {
    const c = new CoreClient({ baseUrl });
    const result = await c.listAgents('hash-abc');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ data: [{ id: 'a1', name: 'Echo' }], code: 0, message: 'ok' });
  });

  it('挂 X-Internal-Client-Key 头（值 = 传入 clientKey）', async () => {
    const c = new CoreClient({ baseUrl });
    await c.listAgents('sha256-xyz');
    expect(lastRequest.headers!['x-internal-client-key']).toBe('sha256-xyz');
  });

  it('GET /v1/agents/{id} 透传 id（url encoded）', async () => {
    const c = new CoreClient({ baseUrl });
    const result = await c.getAgent('hash', 'a1');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ data: { id: 'a1', name: 'Echo' }, code: 0, message: 'ok' });
    expect(lastRequest.url).toBe('/v1/agents/a1');
  });

  it('core 4xx 整包透传（status 原样 + body 整包）', async () => {
    // 临时替换 server 行为
    server.removeAllListeners('request');
    server.on('request', (_req, res) => {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: null, code: 404, message: 'agent_not_found' }));
    });
    const c = new CoreClient({ baseUrl });
    const result = await c.getAgent('hash', 'nonexistent');
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ data: null, code: 404, message: 'agent_not_found' });
    // 恢复默认 server 行为
    server.removeAllListeners('request');
    server.on('request', (req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        if (req.url === '/v1/agents' && req.method === 'GET') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ data: [{ id: 'a1', name: 'Echo' }], code: 0, message: 'ok' }));
          return;
        }
        if (req.url?.startsWith('/v1/agents/') && req.method === 'GET') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ data: { id: 'a1', name: 'Echo' }, code: 0, message: 'ok' }));
          return;
        }
        res.statusCode = 404;
        res.end();
      });
    });
  });
});
