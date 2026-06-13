// CoreClient 单元测试：直接覆盖 11 个方法（health + 改造 listAgents + 9 新方法）的类层契约。
// v6.2 (Option B)：call() 整包保留 core 的 {data, code, message}；本文件测 CoreClient 与 mock core server 的 HTTP 契约。
// 路由层单测（test/routes/*）和集成测（test/integration/*）另有覆盖，本文件不重复它们的路由层断言。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { CoreClient } from '@/clients/core.js';

let server: Server;
let baseUrl: string;
type LastRequest = {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};
let lastRequest: LastRequest = {
  method: '',
  url: '',
  headers: {},
  body: '',
};

// mockResponseFn：测试可整体替换来覆盖默认行为（如 4xx case）。
// 签名：(method, url, requestBodyStr) => { status, body }
type MockResponse = { status: number; body: unknown };
let mockResponseFn: (method: string, url: string, reqBody: string) => MockResponse = (
  method,
  url,
  reqBody,
) => defaultMock(method, url, reqBody);

function defaultMock(method: string, url: string, reqBody: string): MockResponse {
  // GET /v1/agents
  if (url === '/v1/agents' && method === 'GET') {
    return { status: 200, body: { data: [{ id: 'a1', name: 'Echo' }], code: 0, message: 'ok' } };
  }
  // GET /v1/agents/{id}
  if (url.startsWith('/v1/agents/') && method === 'GET') {
    return { status: 200, body: { data: { id: 'a1', name: 'Echo' }, code: 0, message: 'ok' } };
  }
  // POST /v1/agents
  if (url === '/v1/agents' && method === 'POST') {
    const payload = reqBody ? (JSON.parse(reqBody) as { name?: string; id?: string }) : {};
    return {
      status: 200,
      body: {
        data: { id: payload.id ?? 'new', name: payload.name ?? 'New' },
        code: 0,
        message: 'ok',
      },
    };
  }
  // PATCH /v1/agents/{id}
  if (url.startsWith('/v1/agents/') && method === 'PATCH') {
    return {
      status: 200,
      body: { data: { id: 'a1', ...(reqBody ? JSON.parse(reqBody) : {}) }, code: 0, message: 'ok' },
    };
  }
  // DELETE /v1/agents/{id}
  if (url.startsWith('/v1/agents/') && method === 'DELETE') {
    return { status: 200, body: { data: null, code: 0, message: 'ok' } };
  }
  // POST /v1/sessions
  if (url === '/v1/sessions' && method === 'POST') {
    const payload = reqBody ? (JSON.parse(reqBody) as { id?: string; agentId?: string }) : {};
    return {
      status: 200,
      body: {
        data: { id: payload.id ?? 's1', agentId: payload.agentId ?? 'a1' },
        code: 0,
        message: 'ok',
      },
    };
  }
  // GET /v1/sessions/{id}（不含 /messages 子路径）
  if (url.startsWith('/v1/sessions/') && !url.includes('/messages') && method === 'GET') {
    return { status: 200, body: { data: { id: 's1', agentId: 'a1' }, code: 0, message: 'ok' } };
  }
  // DELETE /v1/sessions/{id}
  if (url.startsWith('/v1/sessions/') && !url.includes('/messages') && method === 'DELETE') {
    return { status: 200, body: { data: null, code: 0, message: 'ok' } };
  }
  // GET /v1/sessions/{id}/messages
  if (url.includes('/messages') && method === 'GET') {
    return { status: 200, body: { data: [{ id: 'm1', role: 'user' }], code: 0, message: 'ok' } };
  }
  // POST /v1/sessions/{id}/messages
  if (url.includes('/messages') && method === 'POST') {
    const payload = reqBody ? (JSON.parse(reqBody) as { id?: string }) : {};
    return {
      status: 200,
      body: {
        data: {
          userMessage: { id: payload.id ?? 'um' },
          assistantMessage: { id: 'am', content: 'reply' },
        },
        code: 0,
        message: 'ok',
      },
    };
  }
  // 默认 404
  return { status: 404, body: { data: null, code: 404, message: 'not_found' } };
}

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // 收集请求元数据供测试断言
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      // exactOptionalPropertyTypes 下 req.method / url 可能 undefined，兜底为空串。
      lastRequest = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers as Record<string, string | string[] | undefined>,
        body: chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : '',
      };

      const resp = mockResponseFn(lastRequest.method, lastRequest.url, lastRequest.body);
      res.statusCode = resp.status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(resp.body));
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

// 每个 it 之间重置 lastRequest 和 mockResponseFn（避免前一个 case 状态泄漏）
function resetRequest() {
  lastRequest = { method: '', url: '', headers: {}, body: '' };
  mockResponseFn = defaultMock;
}

describe('CoreClient header injection', () => {
  it('所有方法挂 X-Internal-Client-Key 头（值 = 传入 clientKey）', async () => {
    resetRequest();
    const c = new CoreClient({ baseUrl });
    await c.listAgents('sha256-abc');
    expect(lastRequest.headers['x-internal-client-key']).toBe('sha256-abc');
  });

  it('所有方法挂 Content-Type: application/json', async () => {
    resetRequest();
    const c = new CoreClient({ baseUrl });
    await c.listAgents('sha256-abc');
    expect(lastRequest.headers['content-type']).toBe('application/json');
  });
});

describe('CoreClient.listAgents()', () => {
  it('GET /v1/agents 透传 status + body (整包)', async () => {
    resetRequest();
    const c = new CoreClient({ baseUrl });
    const result = await c.listAgents('hash');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ data: [{ id: 'a1', name: 'Echo' }], code: 0, message: 'ok' });
    expect(lastRequest.method).toBe('GET');
    expect(lastRequest.url).toBe('/v1/agents');
  });
});

describe('CoreClient.createAgent()', () => {
  it('POST /v1/agents 透传 status + body (整包)，请求 body JSON 序列化', async () => {
    resetRequest();
    const c = new CoreClient({ baseUrl });
    const result = await c.createAgent('hash', { id: 'a-new', name: 'New' });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ data: { id: 'a-new', name: 'New' }, code: 0, message: 'ok' });
    expect(lastRequest.method).toBe('POST');
    expect(lastRequest.url).toBe('/v1/agents');
    expect(JSON.parse(lastRequest.body)).toEqual({ id: 'a-new', name: 'New' });
  });
});

describe('CoreClient.getAgent()', () => {
  it('GET /v1/agents/{id} 透传 id (url encoded)', async () => {
    resetRequest();
    const c = new CoreClient({ baseUrl });
    const result = await c.getAgent('hash', 'a/1');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ data: { id: 'a1', name: 'Echo' }, code: 0, message: 'ok' });
    expect(lastRequest.url).toBe('/v1/agents/a%2F1'); // '/' 被 encode
  });
});

describe('CoreClient.updateAgent()', () => {
  it('PATCH /v1/agents/{id} 透传 status + body (整包)，请求 body JSON 序列化', async () => {
    resetRequest();
    const c = new CoreClient({ baseUrl });
    const result = await c.updateAgent('hash', 'a1', { name: 'Renamed' });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ data: { id: 'a1', name: 'Renamed' }, code: 0, message: 'ok' });
    expect(lastRequest.method).toBe('PATCH');
    expect(lastRequest.url).toBe('/v1/agents/a1');
    expect(JSON.parse(lastRequest.body)).toEqual({ name: 'Renamed' });
  });
});

describe('CoreClient.deleteAgent()', () => {
  it('DELETE /v1/agents/{id} 透传 status + body (整包)，无请求 body', async () => {
    resetRequest();
    const c = new CoreClient({ baseUrl });
    const result = await c.deleteAgent('hash', 'a1');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ data: null, code: 0, message: 'ok' });
    expect(lastRequest.method).toBe('DELETE');
    expect(lastRequest.url).toBe('/v1/agents/a1');
    expect(lastRequest.body).toBe(''); // DELETE 不发 body
  });
});

describe('CoreClient.createSession()', () => {
  it('POST /v1/sessions 透传 status + body (整包)，请求 body JSON 序列化', async () => {
    resetRequest();
    const c = new CoreClient({ baseUrl });
    const result = await c.createSession('hash', { id: 's-new', agentId: 'a1' });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      data: { id: 's-new', agentId: 'a1' },
      code: 0,
      message: 'ok',
    });
    expect(lastRequest.method).toBe('POST');
    expect(lastRequest.url).toBe('/v1/sessions');
    expect(JSON.parse(lastRequest.body)).toEqual({ id: 's-new', agentId: 'a1' });
  });
});

describe('CoreClient.getSession()', () => {
  it('GET /v1/sessions/{id} 透传 status + body (整包)，不含 /messages 子路径', async () => {
    resetRequest();
    const c = new CoreClient({ baseUrl });
    const result = await c.getSession('hash', 's1');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ data: { id: 's1', agentId: 'a1' }, code: 0, message: 'ok' });
    expect(lastRequest.method).toBe('GET');
    expect(lastRequest.url).toBe('/v1/sessions/s1');
  });
});

describe('CoreClient.deleteSession()', () => {
  it('DELETE /v1/sessions/{id} 透传 status + body (整包)，不含 /messages 子路径，无请求 body', async () => {
    resetRequest();
    const c = new CoreClient({ baseUrl });
    const result = await c.deleteSession('hash', 's1');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ data: null, code: 0, message: 'ok' });
    expect(lastRequest.method).toBe('DELETE');
    expect(lastRequest.url).toBe('/v1/sessions/s1');
    expect(lastRequest.body).toBe('');
  });
});

describe('CoreClient.listMessages()', () => {
  it('GET /v1/sessions/{id}/messages 透传 status + body (整包)', async () => {
    resetRequest();
    const c = new CoreClient({ baseUrl });
    const result = await c.listMessages('hash', 's1');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      data: [{ id: 'm1', role: 'user' }],
      code: 0,
      message: 'ok',
    });
    expect(lastRequest.method).toBe('GET');
    expect(lastRequest.url).toBe('/v1/sessions/s1/messages');
  });
});

describe('CoreClient.postMessage()', () => {
  it('POST /v1/sessions/{id}/messages 透传 status + body (整包)，请求 body JSON 序列化', async () => {
    resetRequest();
    const c = new CoreClient({ baseUrl });
    const result = await c.postMessage('hash', 's1', { id: 'um', content: 'hello' });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      data: {
        userMessage: { id: 'um' },
        assistantMessage: { id: 'am', content: 'reply' },
      },
      code: 0,
      message: 'ok',
    });
    expect(lastRequest.method).toBe('POST');
    expect(lastRequest.url).toBe('/v1/sessions/s1/messages');
    expect(JSON.parse(lastRequest.body)).toEqual({ id: 'um', content: 'hello' });
  });
});

describe('CoreClient 错误码透传（4xx/5xx 整包）', () => {
  it('core 4xx 整包透传（status 原样 + body 整包）', async () => {
    resetRequest();
    // 临时覆盖：所有路径都返回 404 agent_not_found
    mockResponseFn = () => ({
      status: 404,
      body: { data: null, code: 404, message: 'agent_not_found' },
    });
    const c = new CoreClient({ baseUrl });
    const result = await c.getAgent('hash', 'nonexistent');
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ data: null, code: 404, message: 'agent_not_found' });
  });

  it('core 5xx 整包透传（status 原样 + body 整包）', async () => {
    resetRequest();
    mockResponseFn = () => ({
      status: 502,
      body: { data: null, code: 502, message: 'upstream_error' },
    });
    const c = new CoreClient({ baseUrl });
    const result = await c.postMessage('hash', 's1', { id: 'um', content: 'x' });
    expect(result.status).toBe(502);
    expect(result.body).toEqual({ data: null, code: 502, message: 'upstream_error' });
  });
});

describe('CoreClient timeoutMs default (v6.5)', () => {
  // v6.5: 不传 timeoutMs 时 default 640_000，对齐 config.ts CORE_TIMEOUT_MS。
  //   server.ts 启动时显式传入；这里是兜底：未传时绝不能退回到老的 15_000。
  it('v6.5: CoreClient 不传 timeoutMs 时 default 640_000', () => {
    const c = new CoreClient({ baseUrl });
    // 私有字段直读：契约测试，锁 default 不会悄悄被改回 15_000。
    expect((c as unknown as { timeoutMs: number }).timeoutMs).toBe(640_000);
  });

  it('v6.5: CoreClient 显式传 timeoutMs 时使用传入值（不落 default）', () => {
    const c = new CoreClient({ baseUrl, timeoutMs: 12_345 });
    expect((c as unknown as { timeoutMs: number }).timeoutMs).toBe(12_345);
  });
});
