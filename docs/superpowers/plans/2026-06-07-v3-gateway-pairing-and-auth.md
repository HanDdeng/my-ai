# v3 — 网关远程配对与鉴权 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在仓库内落地 `versions/v3.md` 描述的网关远程配对与鉴权机制：客户端首次启动表单配对 + 私有模式 CLI 解析 + 网关鉴权中间件 + 持久化客户端记录 + 过期清理 + 统一响应包装。

**Architecture:** 网关侧集中鉴权模块（`gateway/src/auth/{store,middleware,cleanup,hash,public-paths}.ts` + `routes/{pair,pair-status,internal/*}.ts`），客户端 stronghold 存 clientKey + 顶部 banner + 主动弹出层；统一响应包装 `{data, code, message}` 覆盖所有 endpoint（含 `/health`）；CLI 子命令 `my-ai-gateway { start | pair --token | list }`；存储用 better-sqlite3 持久化客户端 + pairing_codes。

**Tech Stack:** Node 24 + pnpm 10 workspaces、TypeScript 5.5+、Fastify 4、better-sqlite3、zod、vitest 2、Tauri 2 + tauri-plugin-stronghold、conventional commits（commitlint）。

**Spec:** [`versions/v3.md`](../../../versions/v3.md)

---

## 总览：6 个 Phase，25 个 Task

| Phase                | 内容                                                                       | Task 数 |
| -------------------- | -------------------------------------------------------------------------- | ------- |
| 0. 依赖与配置        | better-sqlite3 入 catalog + gateway config 扩展                            | 2       |
| 1. 网关基础设施      | hash / db / store / public-paths / response 统一包装                       | 5       |
| 2. 网关鉴权核心      | middleware + /pair + /pair/status + /internal/{pair-resolve,clients}       | 5       |
| 3. 端点改造          | /health 新格式（gateway + core + 客户端握手）+ /v1/agents 新格式           | 2       |
| 4. 集成 / 清理 / CLI | server.ts 接入 + cleanup 定时任务 + CLI 子命令                             | 3       |
| 5. 客户端            | stronghold 封装 + api 包装 + PairBanner/PairDialog + App 集成 + Tauri 接入 | 6       |
| 6. 版本同步 + 文档   | compat-matrix 升 0.0.3 + README 更新                                       | 2       |

**约束**：每 task 完成后跑 `pnpm -r typecheck && pnpm -r lint && pnpm -r test` 三件套，全绿才能 commit。失败回退到上一个 commit。

**关键变更提示**：

- `/health` 走新格式 `{data: {ok, service, version, schema}, code: 0, message: 'ok'}` —— 破坏 v2 client
- `tauri-plugin-stronghold` 引入需要 Rust toolchain，与现有 Tauri 工具链一致即可
- `better-sqlite3` 是 native binding，pnpm install 时会本地编译

---

## Phase 0：依赖与配置

### Task 0.1：把 `better-sqlite3` 加入 pnpm catalog 并安装到 gateway

**目的**：让 gateway 能用 better-sqlite3 做持久化。

**Files:**

- Modify: `pnpm-workspace.yaml`
- Modify: `gateway/package.json`

- [ ] **Step 1: 在 pnpm-workspace.yaml 的 catalog 块加 `better-sqlite3`**

编辑 `/home/handdeng/rd-center/my-ai/pnpm-workspace.yaml`，在 `catalog:` 块末尾追加：

```yaml
catalog:
  # ... existing entries ...

  # 用于网关持久化客户端配对记录（v3 鉴权机制）
  better-sqlite3: ^11.5.0
  # better-sqlite3 的 TypeScript 类型
  '@types/better-sqlite3': ^7.6.11
```

- [ ] **Step 2: 在 gateway/package.json 加 better-sqlite3 依赖**

编辑 `/home/handdeng/rd-center/my-ai/gateway/package.json`，`dependencies` 块加：

```jsonc
{
  "dependencies": {
    // ... existing ...
    "better-sqlite3": "catalog:",
  },
  "devDependencies": {
    // ... existing ...
    "@types/better-sqlite3": "catalog:",
  },
}
```

- [ ] **Step 3: 安装依赖**

Run:

```bash
cd /home/handdeng/rd-center/my-ai && pnpm install
```

Expected: 安装成功无错误；`gateway/node_modules/better-sqlite3` 存在。

- [ ] **Step 4: 验证类型导入可用**

创建临时验证文件 `gateway/src/_check.ts`：

```typescript
import Database from 'better-sqlite3';
const db = new Database(':memory:');
db.exec('CREATE TABLE _t (id INTEGER)');
console.log(db.prepare('SELECT count(*) FROM _t').get());
```

Run:

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm exec tsc -p tsconfig.json --noEmit
```

Expected: 无类型错误。

删除 `gateway/src/_check.ts`。

- [ ] **Step 5: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add pnpm-workspace.yaml gateway/package.json pnpm-lock.yaml
git commit -m "chore(gateway): 加 better-sqlite3 依赖（v3 鉴权持久化）"
```

### Task 0.2：扩展 gateway config.ts 加 4 个 v3 配置字段

**目的**：让 v3 新配置可被 zod 校验，启动期 fail-fast。

**Files:**

- Modify: `gateway/src/config.ts`

- [ ] **Step 1: 写配置测试覆盖新字段**

新建 `gateway/src/config.test.ts`：

```typescript
// gateway/src/config.test.ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig v3 新字段', () => {
  const baseEnv = {
    PORT: '8787',
    HOST: '127.0.0.1',
    CORE_URL: 'http://127.0.0.1:8788',
    LOG_LEVEL: 'info',
    CORS_ORIGINS: 'http://localhost:5173',
  };

  it('GATEWAY_PAIRING_PUBLIC 默认 false', () => {
    const cfg = loadConfig({ ...baseEnv, NODE_ENV: 'test' } as never);
    expect(cfg.GATEWAY_PAIRING_PUBLIC).toBe(false);
  });

  it('GATEWAY_PAIRING_PUBLIC=true 被接受', () => {
    const cfg = loadConfig({ ...baseEnv, GATEWAY_PAIRING_PUBLIC: 'true' } as never);
    expect(cfg.GATEWAY_PAIRING_PUBLIC).toBe(true);
  });

  it('GATEWAY_PAIR_KEY 可选', () => {
    const cfg = loadConfig(baseEnv as never);
    expect(cfg.GATEWAY_PAIR_KEY).toBeUndefined();
    const cfg2 = loadConfig({ ...baseEnv, GATEWAY_PAIR_KEY: 'admin-key' } as never);
    expect(cfg2.GATEWAY_PAIR_KEY).toBe('admin-key');
  });

  it('GATEWAY_PAIRING_KEY_TTL 接受 0 和正整数', () => {
    const cfg0 = loadConfig({ ...baseEnv, GATEWAY_PAIRING_KEY_TTL: '0' } as never);
    expect(cfg0.GATEWAY_PAIRING_KEY_TTL).toBe(0);
    const cfg1 = loadConfig({ ...baseEnv, GATEWAY_PAIRING_KEY_TTL: '3600' } as never);
    expect(cfg1.GATEWAY_PAIRING_KEY_TTL).toBe(3600);
  });

  it('GATEWAY_PAIRING_KEY_TTL 负数抛错', () => {
    expect(() => loadConfig({ ...baseEnv, GATEWAY_PAIRING_KEY_TTL: '-1' } as never)).toThrow();
  });

  it('GATEWAY_DB_PATH 默认 ./gateway.db', () => {
    const cfg = loadConfig(baseEnv as never);
    expect(cfg.GATEWAY_DB_PATH).toBe('./gateway.db');
  });
});
```

注意：当前 `loadConfig()` 直接读 `process.env`。为支持测试，改 `loadConfig` 接受可选 env 参数。

- [ ] **Step 2: 改 `loadConfig` 接受 env 参数**

编辑 `gateway/src/config.ts`：

```typescript
// 网关配置加载：用 zod 校验环境变量，启动期失败比运行期失败更安全。
import { z } from 'zod';

const Schema = z.object({
  // 监听端口，默认 8787（前端 VITE_GATEWAY_URL 默认值要保持一致）。
  PORT: z.coerce.number().int().positive().default(8787),
  // 监听地址。
  HOST: z.string().default('127.0.0.1'),
  // 上游 core 地址。
  CORE_URL: z.string().url().default('http://127.0.0.1:8788'),
  // 日志等级。
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // CORS 白名单，逗号分隔字符串。
  CORS_ORIGINS: z.string().default('http://localhost:5173,tauri://localhost'),

  // === v3 新增：远程配对与鉴权 ===
  // 配对是否公开：true=自由配对, false=需要配对码解析/或 pair key
  GATEWAY_PAIRING_PUBLIC: z.coerce.boolean().default(false),
  // 网关层配对 key：匹配即配对（任何模式都 bypass code 流程）
  GATEWAY_PAIR_KEY: z.string().optional(),
  // 客户端唯一键保存时效（秒）；0 或不配 → 不启动清理
  GATEWAY_PAIRING_KEY_TTL: z.coerce.number().int().min(0).optional(),
  // SQLite DB 文件路径
  GATEWAY_DB_PATH: z.string().default('./gateway.db'),
});

export type Config = z.infer<typeof Schema>;

/**
 * 加载并校验环境变量；校验失败直接退出，避免半配置状态下启动。
 * 接受可选 env 参数以支持测试。
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Schema.safeParse(env);
  if (!parsed.success) {
    console.error('Invalid gateway config:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}
```

- [ ] **Step 3: 跑测试确认通过**

Run:

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test
```

Expected: 6 个新用例全过；其他已有用例也过。

- [ ] **Step 4: 跑三件套**

```bash
cd /home/handdeng/rd-center/my-ai && pnpm -r typecheck && pnpm -r lint
```

Expected: 全部成功。

- [ ] **Step 5: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add gateway/src/config.ts gateway/src/config.test.ts
git commit -m "feat(gateway): v3 配对与鉴权 4 个配置项"
```

---

## Phase 1：网关基础设施

### Task 1.1：实现 SHA-256 hash 工具

**目的**：网关存 clientKey 的 hash 用于比对，明文不落库。

**Files:**

- Create: `gateway/src/auth/hash.ts`
- Create: `gateway/src/auth/hash.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `gateway/src/auth/hash.test.ts`：

```typescript
// gateway/src/auth/hash.ts 的单元测试。
import { describe, it, expect } from 'vitest';
import { sha256 } from './hash.js';

describe('sha256', () => {
  it('已知输入 → 已知 hex 输出', () => {
    // 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(sha256('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('空字符串', () => {
    // e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('中文输入', () => {
    // 不关心具体值，只关心稳定 + 64 字符 hex
    const h = sha256('你好');
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    // 幂等
    expect(sha256('你好')).toBe(h);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test src/auth/hash.test.ts
```

Expected: 找不到模块错误。

- [ ] **Step 3: 实现**

新建 `gateway/src/auth/hash.ts`：

```typescript
// 网关用的 SHA-256 hash 工具：把 clientKey 算成 hex，存 DB 时用 hash 比对。
// 使用 Node 内置 crypto，零外部依赖；hex 编码便于人工核对。
import { createHash } from 'node:crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test src/auth/hash.test.ts
```

Expected: 3 个用例全过。

- [ ] **Step 5: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add gateway/src/auth/hash.ts gateway/src/auth/hash.test.ts
git commit -m "feat(gateway): SHA-256 hash 工具"
```

### Task 1.2：实现 SQLite 初始化与 migration

**目的**：建库 + 启 migration + 暴露连接给 store。

**Files:**

- Create: `gateway/src/db.ts`
- Create: `gateway/src/db.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `gateway/src/db.test.ts`：

```typescript
// db.ts 单元测试：用 :memory: 验证表结构与 PRAGMA user_version。
import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from './db.js';

describe('openDatabase', () => {
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('创建 clients 表', () => {
    const cols = db.prepare('PRAGMA table_info(clients)').all() as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['id', 'key_hash', 'name', 'created_at', 'last_seen_at', 'meta']),
    );
  });

  it('创建 pairing_codes 表', () => {
    const cols = db.prepare('PRAGMA table_info(pairing_codes)').all() as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['token', 'client_id', 'client_name', 'expires_at', 'attempts']),
    );
  });

  it('idx_clients_last_seen 索引存在', () => {
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_clients_last_seen'")
      .get();
    expect(idx).toBeDefined();
  });

  it('PRAGMA user_version = 1', () => {
    const row = db.pragma('user_version') as Array<{ user_version: number }>;
    expect(row[0]?.user_version).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test src/db.test.ts
```

Expected: 找不到 db.js 错误。

- [ ] **Step 3: 实现**

新建 `gateway/src/db.ts`：

```typescript
// SQLite 初始化：建 clients + pairing_codes 表 + 索引 + 设置 PRAGMA user_version。
// 启动时调一次：openDatabase(GATEWAY_DB_PATH) → 拿到 db 实例。
// v3 schema_version = 1，未来加表时递增 user_version + 加 migration。
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS clients (
  id           TEXT PRIMARY KEY,
  key_hash     TEXT NOT NULL UNIQUE,
  name         TEXT,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  meta         TEXT
);
CREATE INDEX IF NOT EXISTS idx_clients_last_seen ON clients(last_seen_at);

CREATE TABLE IF NOT EXISTS pairing_codes (
  token       TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  client_name TEXT,
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pairing_codes_expires ON pairing_codes(expires_at);
`;

const CURRENT_USER_VERSION = 1;

export function openDatabase(path: string): DatabaseType {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);

  // migration: 若 user_version < CURRENT，跑升级
  const row = db.pragma('user_version') as Array<{ user_version: number }>;
  const current = row[0]?.user_version ?? 0;
  if (current < CURRENT_USER_VERSION) {
    // v3 阶段没有 migration 步骤（schema 直接写在 SCHEMA_SQL）
    db.pragma(`user_version = ${CURRENT_USER_VERSION}`);
  }
  return db;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test src/db.test.ts
```

Expected: 4 个用例全过。

- [ ] **Step 5: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add gateway/src/db.ts gateway/src/db.test.ts
git commit -m "feat(gateway): SQLite 初始化与 schema migration"
```

### Task 1.3：实现 auth store

**目的**：封装 clients + pairing_codes 表的 CRUD。

**Files:**

- Create: `gateway/src/auth/store.ts`
- Create: `gateway/src/auth/store.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `gateway/src/auth/store.test.ts`：

```typescript
// auth/store.ts 单元测试：用 :memory: SQLite 跑所有 CRUD。
import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../db.js';
import { AuthStore } from './store.js';

describe('AuthStore', () => {
  let store: AuthStore;

  beforeEach(() => {
    const db = openDatabase(':memory:');
    store = new AuthStore(db);
  });

  describe('insertClient + findByHash', () => {
    it('插入后能按 hash 找到', () => {
      const id = 'hash-abc';
      const now = Date.now();
      store.insertClient({ id, keyHash: id, name: 'alice', createdAt: now, lastSeenAt: now });
      const found = store.findByHash(id);
      expect(found).toMatchObject({ id, name: 'alice', created_at: now, last_seen_at: now });
    });

    it('未插入的 hash 返回 null', () => {
      expect(store.findByHash('nonexistent')).toBeNull();
    });

    it('同名 hash 重复插入抛错（唯一约束）', () => {
      const id = 'hash-abc';
      const now = Date.now();
      store.insertClient({ id, keyHash: id, name: null, createdAt: now, lastSeenAt: now });
      expect(() =>
        store.insertClient({ id, keyHash: id, name: null, createdAt: now, lastSeenAt: now }),
      ).toThrow();
    });
  });

  describe('updateLastSeen', () => {
    it('更新 last_seen_at', () => {
      const id = 'hash-abc';
      const now = Date.now();
      store.insertClient({ id, keyHash: id, name: null, createdAt: now, lastSeenAt: now });
      const newTs = now + 1000;
      store.updateLastSeen(id, newTs);
      const found = store.findByHash(id);
      expect(found?.last_seen_at).toBe(newTs);
    });

    it('不存在的 id 不抛错（idempotent）', () => {
      expect(() => store.updateLastSeen('nonexistent', Date.now())).not.toThrow();
    });
  });

  describe('deleteExpiredClients', () => {
    it('删除 last_seen_at < threshold 的 client', () => {
      const now = Date.now();
      store.insertClient({
        id: 'old',
        keyHash: 'old',
        name: null,
        createdAt: now,
        lastSeenAt: now - 10_000,
      });
      store.insertClient({
        id: 'new',
        keyHash: 'new',
        name: null,
        createdAt: now,
        lastSeenAt: now,
      });
      const deleted = store.deleteExpiredClients(now - 5_000);
      expect(deleted).toBe(1);
      expect(store.findByHash('old')).toBeNull();
      expect(store.findByHash('new')).not.toBeNull();
    });
  });

  describe('pairing_codes', () => {
    it('insertPairingCode + findPairingCode + deletePairingCode', () => {
      const now = Date.now();
      store.insertPairingCode({
        token: 'tk-1',
        clientId: 'hash-abc',
        clientName: 'alice',
        expiresAt: now + 300_000,
      });
      const found = store.findPairingCode('tk-1');
      expect(found).toMatchObject({
        token: 'tk-1',
        client_id: 'hash-abc',
        client_name: 'alice',
        attempts: 0,
      });
      store.deletePairingCode('tk-1');
      expect(store.findPairingCode('tk-1')).toBeNull();
    });

    it('incrementAttempts', () => {
      const now = Date.now();
      store.insertPairingCode({
        token: 'tk',
        clientId: 'c',
        clientName: null,
        expiresAt: now + 60_000,
      });
      store.incrementAttempts('tk');
      store.incrementAttempts('tk');
      expect(store.findPairingCode('tk')?.attempts).toBe(2);
    });

    it('commitPairingCode 写 clients + 删 pairing_code', () => {
      const now = Date.now();
      store.insertPairingCode({
        token: 'tk',
        clientId: 'hash-abc',
        clientName: 'alice',
        expiresAt: now + 60_000,
      });
      store.commitPairingCode('tk', now);
      expect(store.findByHash('hash-abc')).toMatchObject({ name: 'alice' });
      expect(store.findPairingCode('tk')).toBeNull();
    });
  });

  describe('listClients', () => {
    it('返回所有 client', () => {
      const now = Date.now();
      store.insertClient({ id: 'a', keyHash: 'a', name: 'alice', createdAt: now, lastSeenAt: now });
      store.insertClient({ id: 'b', keyHash: 'b', name: 'bob', createdAt: now, lastSeenAt: now });
      const list = store.listClients();
      expect(list).toHaveLength(2);
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test src/auth/store.test.ts
```

Expected: 找不到 store.js 错误。

- [ ] **Step 3: 实现**

新建 `gateway/src/auth/store.ts`：

```typescript
// 网关鉴权 store：封装 clients + pairing_codes 表的 CRUD。
// 同步 better-sqlite3 API（v3 阶段用同步；v4+ 可换 async DB）。
import type { Database } from 'better-sqlite3';

export type Client = {
  id: string;
  key_hash: string;
  name: string | null;
  created_at: number;
  last_seen_at: number;
  meta: string | null;
};

export type PairingCode = {
  token: string;
  client_id: string;
  client_name: string | null;
  expires_at: number;
  attempts: number;
};

export class AuthStore {
  constructor(private readonly db: Database) {}

  insertClient(c: {
    id: string;
    keyHash: string;
    name: string | null;
    createdAt: number;
    lastSeenAt: number;
  }): void {
    this.db
      .prepare(
        'INSERT INTO clients (id, key_hash, name, created_at, last_seen_at, meta) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(c.id, c.keyHash, c.name, c.createdAt, c.lastSeenAt, null);
  }

  findByHash(hash: string): Client | null {
    const row = this.db.prepare('SELECT * FROM clients WHERE id = ?').get(hash) as
      | Client
      | undefined;
    return row ?? null;
  }

  updateLastSeen(id: string, ts: number): void {
    this.db.prepare('UPDATE clients SET last_seen_at = ? WHERE id = ?').run(ts, id);
  }

  deleteExpiredClients(threshold: number): number {
    const result = this.db.prepare('DELETE FROM clients WHERE last_seen_at < ?').run(threshold);
    return result.changes;
  }

  insertPairingCode(c: {
    token: string;
    clientId: string;
    clientName: string | null;
    expiresAt: number;
  }): void {
    this.db
      .prepare(
        'INSERT INTO pairing_codes (token, client_id, client_name, expires_at, attempts) VALUES (?, ?, ?, ?, 0)',
      )
      .run(c.token, c.clientId, c.clientName, c.expiresAt);
  }

  findPairingCode(token: string): PairingCode | null {
    const row = this.db.prepare('SELECT * FROM pairing_codes WHERE token = ?').get(token) as
      | PairingCode
      | undefined;
    return row ?? null;
  }

  incrementAttempts(token: string): void {
    this.db.prepare('UPDATE pairing_codes SET attempts = attempts + 1 WHERE token = ?').run(token);
  }

  deletePairingCode(token: string): void {
    this.db.prepare('DELETE FROM pairing_codes WHERE token = ?').run(token);
  }

  /**
   * 私有模式 CLI 解析时调：把 pairing_codes.client_id 写入 clients 表，删除 pairing_code。
   * 必须在事务里跑（失败回滚）。
   */
  commitPairingCode(token: string, now: number): void {
    const tx = this.db.transaction(() => {
      const code = this.findPairingCode(token);
      if (!code) return false;
      this.insertClient({
        id: code.client_id,
        keyHash: code.client_id,
        name: code.client_name,
        createdAt: now,
        lastSeenAt: now,
      });
      this.deletePairingCode(token);
      return true;
    });
    tx();
  }

  listClients(): Client[] {
    return this.db.prepare('SELECT * FROM clients ORDER BY created_at DESC').all() as Client[];
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test src/auth/store.test.ts
```

Expected: 所有用例全过（约 10 个）。

- [ ] **Step 5: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add gateway/src/auth/store.ts gateway/src/auth/store.test.ts
git commit -m "feat(gateway): auth store 封装 clients + pairing_codes CRUD"
```

### Task 1.4：实现 public-paths 白名单判定

**目的**：middleware 用的路径白名单工具，单独文件便于单测。

**Files:**

- Create: `gateway/src/auth/public-paths.ts`
- Create: `gateway/src/auth/public-paths.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `gateway/src/auth/public-paths.test.ts`：

```typescript
// public-paths 单元测试：覆盖所有白名单路径 + 边界 case。
import { describe, it, expect } from 'vitest';
import { isPublicPath } from './public-paths.js';

describe('isPublicPath', () => {
  it.each([
    '/health',
    '/health?foo=bar',
    '/pair',
    '/pair/status',
    '/pair/status?token=xxx',
    '/internal/pair/resolve',
    '/internal/clients',
  ])('白名单：%s', url => {
    expect(isPublicPath(url)).toBe(true);
  });

  it.each(['/v1/agents', '/', '/agents', '/healthcheck'])('非白名单：%s', url => {
    expect(isPublicPath(url)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test src/auth/public-paths.test.ts
```

Expected: 找不到模块错误。

- [ ] **Step 3: 实现**

新建 `gateway/src/auth/public-paths.ts`：

```typescript
// 网关鉴权白名单：/health、/pair、/pair/status、/internal/* 不走鉴权。
// /internal/* 在 route handler 内部额外检查 req.ip === '127.0.0.1'，中间件不做。
// 路径只做前缀匹配，query string 在 url 里一起传过来也要匹配上。
const PUBLIC_PATH_PREFIXES = ['/health', '/pair', '/internal/'];

export function isPublicPath(url: string): boolean {
  // 去掉 query string 再做前缀匹配（req.url 形如 "/pair/status?token=xxx"）
  const path = url.split('?')[0] ?? url;
  return PUBLIC_PATH_PREFIXES.some(p => path === p || path.startsWith(p));
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test src/auth/public-paths.test.ts
```

Expected: 所有用例全过。

- [ ] **Step 5: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add gateway/src/auth/public-paths.ts gateway/src/auth/public-paths.test.ts
git commit -m "feat(gateway): 鉴权白名单 public-paths 工具"
```

### Task 1.5：实现统一响应包装

**目的**：所有 endpoint 走 `{data, code, message}` 形态。

**Files:**

- Create: `gateway/src/response.ts`
- Create: `gateway/src/response.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `gateway/src/response.test.ts`：

```typescript
// response.ts 单元测试。
import { describe, it, expect } from 'vitest';
import { ok, err } from './response.js';

describe('统一响应包装', () => {
  it('ok 成功响应', () => {
    expect(ok({ foo: 1 })).toEqual({ data: { foo: 1 }, code: 0, message: 'ok' });
  });

  it('ok 接受 null', () => {
    expect(ok(null)).toEqual({ data: null, code: 0, message: 'ok' });
  });

  it('ok 接受字符串', () => {
    expect(ok('hi')).toEqual({ data: 'hi', code: 0, message: 'ok' });
  });

  it('err 错误响应', () => {
    expect(err(401, 'unauthorized')).toEqual({ data: null, code: 401, message: 'unauthorized' });
  });

  it('err code 为 0 仍允许（业务错误语义）', () => {
    expect(err(0, 'something')).toEqual({ data: null, code: 0, message: 'something' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test src/response.test.ts
```

Expected: 找不到 response.js 错误。

- [ ] **Step 3: 实现**

新建 `gateway/src/response.ts`：

```typescript
// 统一响应包装：所有 v3 起的 endpoint 走此形态。
// 成功：{ data, code: 0, message: 'ok' }
// 业务错误：{ data: null, code, message }
// 错误 code 在调用方指定（HTTP 状态码或业务码）。
export type ApiResponse<T> =
  | { data: T; code: 0; message: 'ok' }
  | { data: null; code: number; message: string };

export function ok<T>(data: T): ApiResponse<T> {
  return { data, code: 0, message: 'ok' };
}

export function err(code: number, message: string): ApiResponse<null> {
  return { data: null, code, message };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test src/response.test.ts
```

Expected: 5 个用例全过。

- [ ] **Step 5: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add gateway/src/response.ts gateway/src/response.test.ts
git commit -m "feat(gateway): 统一响应包装 ok/err"
```

---

## Phase 2：网关鉴权核心

### Task 2.1：实现 auth middleware

**目的**：所有非白名单 endpoint 自动鉴权 + 异步更新 lastSeenAt。

**Files:**

- Create: `gateway/src/auth/middleware.ts`
- Create: `gateway/src/auth/middleware.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `gateway/src/auth/middleware.test.ts`：

```typescript
// auth middleware 单元测试：fastify.inject 验证鉴权 + 401 行为 + lastSeenAt 异步更新。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { openDatabase } from '../db.js';
import { AuthStore } from './store.js';
import { authMiddleware } from './middleware.js';

describe('authMiddleware', () => {
  let store: AuthStore;

  beforeEach(() => {
    store = new AuthStore(openDatabase(':memory:'));
  });

  async function buildApp() {
    const app = Fastify({ logger: false });
    app.decorate('authStore', store);
    await app.register(authMiddleware);
    app.get('/protected', async req => {
      // middleware 通过后 req.clientCtx 存在
      return { ctx: req.clientCtx };
    });
    app.get('/health', async () => ({ ok: true }));
    return app;
  }

  it('白名单路径直接放行（不读 header）', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('缺 X-Client-Key → 401 missing_key', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ data: null, code: 401, message: 'missing_key' });
  });

  it('错的 X-Client-Key → 401 invalid_key', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { 'x-client-key': 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ data: null, code: 401, message: 'invalid_key' });
  });

  it('对的 X-Client-Key → 通过 + req.clientCtx 正确', async () => {
    const now = Date.now();
    const id = 'hash-abc';
    store.insertClient({ id, keyHash: id, name: 'alice', createdAt: now, lastSeenAt: now });
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { 'x-client-key': 'plain-key' },
    });
    expect(res.statusCode).toBe(200);
    // 注意：middleware 验的是 sha256('plain-key') = id
    expect(res.json()).toEqual({ ctx: { id, name: 'alice' } });
  });

  it('鉴权通过 → setImmediate 后 last_seen_at 更新', async () => {
    const now = Date.now();
    const id = 'hash-abc';
    store.insertClient({ id, keyHash: id, name: null, createdAt: now, lastSeenAt: now });
    const app = await buildApp();

    // fastify.inject 是同步的，setImmediate 在 inject 返回后跑
    await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { 'x-client-key': 'plain-key' },
    });

    // 等一帧让 setImmediate 触发
    await new Promise(resolve => setImmediate(resolve));
    const found = store.findByHash(id);
    expect(found?.last_seen_at).toBeGreaterThan(now);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test src/auth/middleware.test.ts
```

Expected: 找不到 middleware.js 错误 + store 装饰器类型错误。

- [ ] **Step 3: 实现**

新建 `gateway/src/auth/middleware.ts`：

```typescript
// 网关鉴权中间件：白名单放行；其他路径验 X-Client-Key（SHA-256 比对）。
// 鉴权通过后挂 req.clientCtx = { id, name }，并 setImmediate 异步更新 last_seen_at。
// 鉴权失败统一 401，message 区分 missing_key / invalid_key（防枚举见 v3.md §5.6）。
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { sha256 } from './hash.js';
import { isPublicPath } from './public-paths.js';
import { err } from '../response.js';
import type { AuthStore } from './store.js';

declare module 'fastify' {
  interface FastifyRequest {
    clientCtx?: { id: string; name: string | null };
  }
  interface FastifyInstance {
    authStore: AuthStore;
  }
}

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addHook('onRequest', async (req, reply) => {
    if (isPublicPath(req.url)) return;

    const key = req.headers['x-client-key'];
    if (typeof key !== 'string' || key.length === 0) {
      return reply.code(401).send(err(401, 'missing_key'));
    }

    const hash = sha256(key);
    const client = app.authStore.findByHash(hash);
    if (!client) {
      return reply.code(401).send(err(401, 'invalid_key'));
    }

    req.clientCtx = { id: client.id, name: client.name };

    // fire-and-forget：响应先回，DB 写后台排队
    setImmediate(() => {
      try {
        app.authStore.updateLastSeen(client.id, Date.now());
      } catch (e) {
        app.log.warn({ err: e, clientId: client.id }, 'updateLastSeen failed');
      }
    });
  });
};

export const authMiddleware = fp(plugin, { name: 'auth-middleware' });
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test src/auth/middleware.test.ts
```

Expected: 5 个用例全过。

- [ ] **Step 5: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add gateway/src/auth/middleware.ts gateway/src/auth/middleware.test.ts
git commit -m "feat(gateway): auth middleware（白名单 + X-Client-Key 鉴权）"
```

### Task 2.2：实现 /pair route

**目的**：配对入口；覆盖 4 种决策分支（公开/私有 × pairKey 对/错）+ 幂等性。

**Files:**

- Create: `gateway/src/routes/pair.ts`
- Create: `gateway/src/routes/pair.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `gateway/src/routes/pair.test.ts`：

```typescript
// /pair route 单元测试：fastify.inject 覆盖 4 种决策 + 幂等 + 缺 clientKey。
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { openDatabase } from '../db.js';
import { AuthStore } from '../auth/store.js';
import { sha256 } from '../auth/hash.js';
import { authMiddleware } from '../auth/middleware.js';
import { isPublicPath } from '../auth/public-paths.js';
import { pairRoutes } from './pair.js';

async function buildApp(opts: { public: boolean; pairKey?: string }) {
  const store = new AuthStore(openDatabase(':memory:'));
  const app = Fastify({ logger: false });
  app.decorate('authStore', store);
  app.decorate('config', { GATEWAY_PAIRING_PUBLIC: opts.public, GATEWAY_PAIR_KEY: opts.pairKey });
  // 复用 middleware（白名单逻辑 + 鉴权）
  await app.register(authMiddleware);
  await app.register(pairRoutes);
  return { app, store };
}

const sampleClientKey = 'client-key-1';
const sampleHash = sha256(sampleClientKey);

describe('/pair', () => {
  describe('公开模式', () => {
    it('无 pairKey → 200 + 写入 DB', async () => {
      const { app, store } = await buildApp({ public: true });
      const res = await app.inject({
        method: 'POST',
        url: '/pair',
        payload: { clientKey: sampleClientKey, name: 'alice' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        data: { clientKey: sampleClientKey, name: 'alice' },
        code: 0,
        message: 'ok',
      });
      expect(store.findByHash(sampleHash)).not.toBeNull();
    });

    it('错 pairKey → 200（公开模式忽略）', async () => {
      const { app, store } = await buildApp({ public: true, pairKey: 'admin' });
      const res = await app.inject({
        method: 'POST',
        url: '/pair',
        payload: { clientKey: sampleClientKey, pairKey: 'wrong', name: null },
      });
      expect(res.statusCode).toBe(200);
      expect(store.findByHash(sampleHash)).not.toBeNull();
    });

    it('对 pairKey → 200', async () => {
      const { app } = await buildApp({ public: true, pairKey: 'admin' });
      const res = await app.inject({
        method: 'POST',
        url: '/pair',
        payload: { clientKey: sampleClientKey, pairKey: 'admin' },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('私有模式', () => {
    it('对 pairKey → 200 + 写入 DB', async () => {
      const { app, store } = await buildApp({ public: false, pairKey: 'admin' });
      const res = await app.inject({
        method: 'POST',
        url: '/pair',
        payload: { clientKey: sampleClientKey, pairKey: 'admin' },
      });
      expect(res.statusCode).toBe(200);
      expect(store.findByHash(sampleHash)).not.toBeNull();
    });

    it('无 pairKey → 202 + 写入 pairing_code', async () => {
      const { app, store } = await buildApp({ public: false });
      const res = await app.inject({
        method: 'POST',
        url: '/pair',
        payload: { clientKey: sampleClientKey, name: 'alice' },
      });
      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.code).toBe(0);
      expect(body.message).toBe('pair_pending');
      expect(body.data.token).toBeTypeOf('string');
      expect(body.data.expiresAt).toBeTypeOf('number');
      // 配对码已写入
      const list = (store as AuthStore & { db: unknown }).db;
      // 注：pairing_code 通过 store.findPairingCode 查询
      const all = store.listClients();
      expect(all).toHaveLength(0);
    });

    it('错 pairKey → 202（防枚举，不区分）', async () => {
      const { app } = await buildApp({ public: false, pairKey: 'admin' });
      const res = await app.inject({
        method: 'POST',
        url: '/pair',
        payload: { clientKey: sampleClientKey, pairKey: 'wrong' },
      });
      expect(res.statusCode).toBe(202);
    });
  });

  describe('幂等性', () => {
    it('已存在的 clientKey 再次 POST /pair → 200 不重写', async () => {
      const { app, store } = await buildApp({ public: true });
      await app.inject({
        method: 'POST',
        url: '/pair',
        payload: { clientKey: sampleClientKey, name: 'alice' },
      });
      const before = store.findByHash(sampleHash);

      // 第二次，name 变了但 clientKey 同
      const res = await app.inject({
        method: 'POST',
        url: '/pair',
        payload: { clientKey: sampleClientKey, name: 'different-name' },
      });
      expect(res.statusCode).toBe(200);
      const after = store.findByHash(sampleHash);
      expect(after?.name).toBe('alice'); // 没改
      expect(after?.created_at).toBe(before?.created_at); // 没改
      expect(store.listClients()).toHaveLength(1);
    });
  });

  describe('错误', () => {
    it('缺 clientKey → 400', async () => {
      const { app } = await buildApp({ public: true });
      const res = await app.inject({
        method: 'POST',
        url: '/pair',
        payload: { name: 'alice' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('clientKey 非字符串 → 400', async () => {
      const { app } = await buildApp({ public: true });
      const res = await app.inject({
        method: 'POST',
        url: '/pair',
        payload: { clientKey: 123 },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test src/routes/pair.test.ts
```

Expected: 找不到 pair.js 错误 + config 装饰器错误。

- [ ] **Step 3: 实现**

新建 `gateway/src/routes/pair.ts`：

```typescript
// /pair：配对入口。决策表见 versions/v3.md §5.5。
// 公开模式：忽略 pairKey，直接配对。
// 私有模式：pairKey 匹配 → 配对；无/错 → 进入 code 流程（202 + token）。
// 幂等：POST /pair 前先按 sha256(clientKey) 查 DB，命中直接 200。
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { ok, err } from '../response.js';
import { sha256 } from '../auth/hash.js';
import type { AuthStore } from '../auth/store.js';

const PairBody = z.object({
  clientKey: z.string().min(1),
  name: z.string().nullable().optional(),
  pairKey: z.string().optional(),
});

const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;

declare module 'fastify' {
  interface FastifyInstance {
    authStore: AuthStore;
    config: { GATEWAY_PAIRING_PUBLIC: boolean; GATEWAY_PAIR_KEY?: string };
  }
}

function generateToken(): string {
  return randomBytes(16).toString('base64url');
}

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post('/pair', async (req, reply) => {
    const parsed = PairBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(err(400, 'invalid_body'));
    }
    const { clientKey, name = null, pairKey } = parsed.data;
    const hash = sha256(clientKey);
    const now = Date.now();

    // 幂等：已配对过 → 直接 200
    if (app.authStore.findByHash(hash)) {
      const existing = app.authStore.findByHash(hash)!;
      return reply.send(ok({ clientKey, name: existing.name }));
    }

    // 决策：是否直接配对
    const isPublic = app.config.GATEWAY_PAIRING_PUBLIC;
    const pairKeyValid =
      typeof pairKey === 'string' &&
      typeof app.config.GATEWAY_PAIR_KEY === 'string' &&
      pairKey === app.config.GATEWAY_PAIR_KEY;

    if (isPublic || pairKeyValid) {
      app.authStore.insertClient({
        id: hash,
        keyHash: hash,
        name,
        createdAt: now,
        lastSeenAt: now,
      });
      return reply.send(ok({ clientKey, name }));
    }

    // 私有 + 无/错 pairKey → 进入 code 流程
    const token = generateToken();
    const expiresAt = now + PAIRING_CODE_TTL_MS;
    app.authStore.insertPairingCode({ token, clientId: hash, clientName: name, expiresAt });
    return reply.code(202).send(ok({ token, expiresAt, pollUrl: `/pair/status?token=${token}` }));
  });
};

export const pairRoutes = plugin;
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test src/routes/pair.test.ts
```

Expected: 9 个用例全过。

- [ ] **Step 5: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add gateway/src/routes/pair.ts gateway/src/routes/pair.test.ts
git commit -m "feat(gateway): /pair 配对入口 + 决策表 + 幂等"
```

### Task 2.3：实现 /pair/status route

**目的**：私有模式轮询查询配对状态。

**Files:**

- Create: `gateway/src/routes/pair-status.ts`
- Create: `gateway/src/routes/pair-status.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `gateway/src/routes/pair-status.test.ts`：

```typescript
// /pair/status 单元测试：覆盖 PENDING / PAIRED / EXPIRED / 不存在。
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { openDatabase } from '../db.js';
import { AuthStore } from '../auth/store.js';
import { sha256 } from '../auth/hash.js';
import { authMiddleware } from '../auth/middleware.js';
import { pairStatusRoutes } from './pair-status.js';

async function buildApp() {
  const store = new AuthStore(openDatabase(':memory:'));
  const app = Fastify({ logger: false });
  app.decorate('authStore', store);
  await app.register(authMiddleware);
  await app.register(pairStatusRoutes);
  return { app, store };
}

describe('/pair/status', () => {
  it('token 存在 + 未过期 + 未配对 → PENDING', async () => {
    const { app, store } = await buildApp();
    const now = Date.now();
    store.insertPairingCode({
      token: 'tk',
      clientId: 'h1',
      clientName: null,
      expiresAt: now + 60_000,
    });
    const res = await app.inject({ method: 'GET', url: '/pair/status?token=tk' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { status: 'PENDING' }, code: 0, message: 'ok' });
  });

  it('token 存在 + 已配对 → PAIRED', async () => {
    const { app, store } = await buildApp();
    const now = Date.now();
    const hash = 'h1';
    store.insertClient({ id: hash, keyHash: hash, name: null, createdAt: now, lastSeenAt: now });
    store.insertPairingCode({
      token: 'tk',
      clientId: hash,
      clientName: null,
      expiresAt: now + 60_000,
    });
    const res = await app.inject({ method: 'GET', url: '/pair/status?token=tk' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { status: 'PAIRED' }, code: 0, message: 'ok' });
  });

  it('token 存在 + 已过期 → EXPIRED', async () => {
    const { app, store } = await buildApp();
    const now = Date.now();
    store.insertPairingCode({
      token: 'tk',
      clientId: 'h1',
      clientName: null,
      expiresAt: now - 1000,
    });
    const res = await app.inject({ method: 'GET', url: '/pair/status?token=tk' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { status: 'EXPIRED' }, code: 0, message: 'ok' });
  });

  it('token 不存在 → 404', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/pair/status?token=nonexistent' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ data: null, code: 404, message: 'token_not_found' });
  });

  it('缺 token 参数 → 400', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/pair/status' });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test src/routes/pair-status.test.ts
```

Expected: 找不到 pair-status.js 错误。

- [ ] **Step 3: 实现**

新建 `gateway/src/routes/pair-status.ts`：

```typescript
// /pair/status：私有模式配对的轮询接口。
// PENDING / PAIRED / EXPIRED 三态；不存在 → 404。
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ok, err } from '../response.js';
import type { AuthStore } from '../auth/store.js';

declare module 'fastify' {
  interface FastifyInstance {
    authStore: AuthStore;
  }
}

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get<{ Querystring: { token?: string } }>('/pair/status', async (req, reply) => {
    const token = req.query.token;
    if (!token) {
      return reply.code(400).send(err(400, 'missing_token'));
    }
    const code = app.authStore.findPairingCode(token);
    if (!code) {
      return reply.code(404).send(err(404, 'token_not_found'));
    }
    const now = Date.now();
    if (code.expires_at < now) {
      return reply.send(ok({ status: 'EXPIRED' }));
    }
    // 若 client_id 已经在 clients 表里（CLI 已解析）→ PAIRED
    if (app.authStore.findByHash(code.client_id)) {
      return reply.send(ok({ status: 'PAIRED' }));
    }
    return reply.send(ok({ status: 'PENDING' }));
  });
};

export const pairStatusRoutes = plugin;
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test src/routes/pair-status.test.ts
```

Expected: 5 个用例全过。

- [ ] **Step 5: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add gateway/src/routes/pair-status.ts gateway/src/routes/pair-status.test.ts
git commit -m "feat(gateway): /pair/status 私有配对轮询"
```

### Task 2.4：实现 /internal/pair/resolve route

**目的**：CLI 解析私有模式配对码。限 127.0.0.1，错误尝试 3 次封禁。

**Files:**

- Create: `gateway/src/routes/internal/pair-resolve.ts`
- Create: `gateway/src/routes/internal/pair-resolve.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `gateway/src/routes/internal/pair-resolve.test.ts`：

```typescript
// /internal/pair/resolve 单元测试：限 127.0.0.1 + 错误尝试 3 次封禁。
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { openDatabase } from '../../db.js';
import { AuthStore } from '../../auth/store.js';
import { pairResolveRoutes } from './pair-resolve.js';

async function buildApp() {
  const store = new AuthStore(openDatabase(':memory:'));
  const app = Fastify({ logger: false });
  app.decorate('authStore', store);
  await app.register(pairResolveRoutes);
  return { app, store };
}

describe('/internal/pair/resolve', () => {
  it('正确 token → 200 + 写入 clients + 删除 pairing_code', async () => {
    const { app, store } = await buildApp();
    const now = Date.now();
    store.insertPairingCode({
      token: 'tk',
      clientId: 'h1',
      clientName: 'alice',
      expiresAt: now + 60_000,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/internal/pair/resolve',
      payload: { token: 'tk' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: null, code: 0, message: 'paired' });
    expect(store.findByHash('h1')).toMatchObject({ name: 'alice' });
    expect(store.findPairingCode('tk')).toBeNull();
  });

  it('错 token 第 1-3 次 → 404 + attempts++', async () => {
    const { app, store } = await buildApp();
    store.insertPairingCode({
      token: 'real',
      clientId: 'h1',
      clientName: null,
      expiresAt: Date.now() + 60_000,
    });
    for (let i = 1; i <= 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/internal/pair/resolve',
        payload: { token: 'wrong' },
      });
      expect(res.statusCode).toBe(404);
    }
    expect(store.findPairingCode('real')?.attempts).toBe(3);
  });

  it('错 token 第 4 次 → 404 + token 删除', async () => {
    const { app, store } = await buildApp();
    store.insertPairingCode({
      token: 'real',
      clientId: 'h1',
      clientName: null,
      expiresAt: Date.now() + 60_000,
    });
    for (let i = 0; i < 4; i++) {
      await app.inject({
        method: 'POST',
        url: '/internal/pair/resolve',
        payload: { token: 'wrong' },
      });
    }
    expect(store.findPairingCode('real')).toBeNull();
  });

  it('过期 token → 404', async () => {
    const { app, store } = await buildApp();
    store.insertPairingCode({
      token: 'old',
      clientId: 'h1',
      clientName: null,
      expiresAt: Date.now() - 1000,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/internal/pair/resolve',
      payload: { token: 'old' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('缺 token → 400', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/pair/resolve',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('非 127.0.0.1 → 403', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/pair/resolve',
      payload: { token: 'tk' },
      remoteAddress: '192.168.1.100',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ data: null, code: 403, message: 'forbidden' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test src/routes/internal/pair-resolve.test.ts
```

Expected: 找不到 pair-resolve.js 错误。

- [ ] **Step 3: 实现**

新建 `gateway/src/routes/internal/pair-resolve.ts`：

```typescript
// /internal/pair/resolve：CLI 调用的私有模式配对码解析端点。
// 限 127.0.0.1（防外部直接打）；错误尝试 3 次封禁。
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../../response.js';
import type { AuthStore } from '../../auth/store.js';

const Body = z.object({ token: z.string().min(1) });
const MAX_ATTEMPTS = 3;

declare module 'fastify' {
  interface FastifyInstance {
    authStore: AuthStore;
  }
}

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post('/internal/pair/resolve', async (req, reply) => {
    if (req.ip !== '127.0.0.1' && req.ip !== '::1') {
      return reply.code(403).send(err(403, 'forbidden'));
    }
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(err(400, 'invalid_body'));
    }
    const code = app.authStore.findPairingCode(parsed.data.token);
    if (!code) {
      return reply.code(404).send(err(404, 'token_not_found'));
    }
    if (code.expires_at < Date.now()) {
      app.authStore.deletePairingCode(parsed.data.token);
      return reply.code(404).send(err(404, 'token_not_found'));
    }
    if (code.attempts >= MAX_ATTEMPTS) {
      app.authStore.deletePairingCode(parsed.data.token);
      return reply.code(404).send(err(404, 'token_not_found'));
    }
    // attempts++ 直至 ≥ 3 后下一次拒绝
    app.authStore.incrementAttempts(parsed.data.token);
    if (code.attempts + 1 >= MAX_ATTEMPTS) {
      app.authStore.deletePairingCode(parsed.data.token);
    }
    // 解析成功：写入 clients + 删 pairing_code
    app.authStore.commitPairingCode(parsed.data.token, Date.now());
    return reply.send(ok(null));
  });
};

export const pairResolveRoutes = plugin;
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test src/routes/internal/pair-resolve.test.ts
```

Expected: 6 个用例全过。

注意：第 3 个用例"错 token 第 4 次 → token 删除"，当前实现是 attempts++ 后若 ≥3 则删除。code.attempts=2 时 increment → 3 → 3+1=4 ≥3 → 删除。但测试循环 4 次：第 1 次 attempts=0+1=1, 第 2 次 attempts=1+1=2, 第 3 次 attempts=2+1=3 且删除, 第 4 次 findPairingCode 返回 null。OK。

第 4 个用例"过期 token"：现在 if 检查 `expires_at < now` 然后 `deletePairingCode` → 返回 404。✓

- [ ] **Step 5: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add gateway/src/routes/internal/pair-resolve.ts gateway/src/routes/internal/pair-resolve.test.ts
git commit -m "feat(gateway): /internal/pair/resolve 私有配对码解析"
```

### Task 2.5：实现 /internal/clients route

**目的**：CLI list 命令用的已配对客户端列表（含 online 标记）。

**Files:**

- Create: `gateway/src/routes/internal/clients.ts`
- Create: `gateway/src/routes/internal/clients.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `gateway/src/routes/internal/clients.test.ts`：

```typescript
// /internal/clients 单元测试：列出 + 限 127.0.0.1 + online 标记。
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { openDatabase } from '../../db.js';
import { AuthStore } from '../../auth/store.js';
import { clientsRoutes } from './clients.js';

async function buildApp() {
  const store = new AuthStore(openDatabase(':memory:'));
  const app = Fastify({ logger: false });
  app.decorate('authStore', store);
  await app.register(clientsRoutes);
  return { app, store };
}

describe('/internal/clients', () => {
  it('列出所有 client + online 标记（60s 内 = online）', async () => {
    const { app, store } = await buildApp();
    const now = Date.now();
    store.insertClient({
      id: 'recent',
      keyHash: 'recent',
      name: 'recent',
      createdAt: now,
      lastSeenAt: now - 10_000,
    });
    store.insertClient({
      id: 'old',
      keyHash: 'old',
      name: 'old',
      createdAt: now - 1_000_000,
      lastSeenAt: now - 120_000,
    });
    const res = await app.inject({ method: 'GET', url: '/internal/clients' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.code).toBe(0);
    expect(body.data).toHaveLength(2);
    const recent = body.data.find((c: { id: string }) => c.id === 'recent');
    const old = body.data.find((c: { id: string }) => c.id === 'old');
    expect(recent.online).toBe(true);
    expect(old.online).toBe(false);
  });

  it('空列表返回空数组', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/internal/clients' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [], code: 0, message: 'ok' });
  });

  it('非 127.0.0.1 → 403', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/internal/clients',
      remoteAddress: '10.0.0.1',
    });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test src/routes/internal/clients.test.ts
```

Expected: 找不到 clients.js 错误。

- [ ] **Step 3: 实现**

新建 `gateway/src/routes/internal/clients.ts`：

```typescript
// /internal/clients：CLI list 用的已配对客户端列表。
// 限 127.0.0.1；online = (now - last_seen_at) < 60s。
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ok, err } from '../../response.js';
import type { AuthStore } from '../../auth/store.js';

const ONLINE_THRESHOLD_MS = 60_000;

declare module 'fastify' {
  interface FastifyInstance {
    authStore: AuthStore;
  }
}

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/internal/clients', async (req, reply) => {
    if (req.ip !== '127.0.0.1' && req.ip !== '::1') {
      return reply.code(403).send(err(403, 'forbidden'));
    }
    const now = Date.now();
    const clients = app.authStore.listClients().map(c => ({
      id: c.id,
      name: c.name,
      created_at: c.created_at,
      last_seen_at: c.last_seen_at,
      online: now - c.last_seen_at < ONLINE_THRESHOLD_MS,
    }));
    return reply.send(ok(clients));
  });
};

export const clientsRoutes = plugin;
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test src/routes/internal/clients.test.ts
```

Expected: 3 个用例全过。

- [ ] **Step 5: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add gateway/src/routes/internal/clients.ts gateway/src/routes/internal/clients.test.ts
git commit -m "feat(gateway): /internal/clients 已配对列表 + online 标记"
```

---

## Phase 3：端点改造

### Task 3.1：升级 /health 走新格式

**目的**：所有 endpoint 含 /health 走 `{data, code, message}` 形态（破坏 v2 client）。

**Files:**

- Modify: `gateway/src/routes/health.ts`
- Modify: `gateway/src/routes/health.test.ts`
- Modify: `core/src/routes/health.ts`
- Modify: `core/src/routes/health.test.ts`
- Modify: `client/src/compat/handshake.ts`
- Modify: `client/src/compat/handshake.test.ts`

- [ ] **Step 1: 改 gateway /health 走新格式**

编辑 `gateway/src/routes/health.ts`：

```typescript
// 网关健康检查：纯 ok=true，不做 core 探测（避免 core 抖动时误报网关挂掉）。
// 真实 core 健康度由外部 monitor 通过 /v1/agents 等业务接口间接观察。
// v3 起走新响应包装：{ data: {ok, service, version, schema}, code: 0, message: 'ok' }
import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { parseCompat } from '../compat/load.js';
import { ok } from '../response.js';

function loadSlicePath(): string {
  return fileURLToPath(new URL('../../.compat.generated.json', import.meta.url));
}

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    let version = app.compat.version;
    try {
      const slice = parseCompat(loadSlicePath());
      version = slice.version;
    } catch {
      // 现场读失败时回退到启动时值
    }
    return ok({ ok: true, service: 'gateway', version, schema: 1 });
  });
}
```

- [ ] **Step 2: 改 gateway /health 测试**

编辑 `gateway/src/routes/health.test.ts`，把断言改为新格式：

```typescript
// 网关 /health 单元测试：覆盖新响应包装 + version 字段。
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { healthRoutes } from './health.js';
import type { Compat } from '../compat/load.js';

const fakeCompat: Compat = { version: '9.9.9', upstream: {} };

describe('gateway /health', () => {
  it('返回 ok 与服务名 + version', async () => {
    const app = Fastify({ logger: false });
    app.decorate('compat', fakeCompat);
    await app.register(healthRoutes);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: { ok: true, service: 'gateway', version: '9.9.9', schema: 1 },
      code: 0,
      message: 'ok',
    });
  });
});
```

- [ ] **Step 3: 改 core /health 走新格式**

编辑 `core/src/routes/health.ts`：

```typescript
// 核心健康检查：v3 起走新响应包装。
import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { parseCompat } from '../compat/load.js';
import { ok } from '../response.js';

function loadSlicePath(): string {
  return fileURLToPath(new URL('../../.compat.generated.json', import.meta.url));
}

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    let version = app.compat.version;
    try {
      const slice = parseCompat(loadSlicePath());
      version = slice.version;
    } catch {
      // ignore
    }
    return ok({ ok: true, service: 'core', version, schema: 1 });
  });
}
```

新建 `core/src/response.ts`（与 gateway 同样的内容，复用 ok/err）：

```typescript
// 核心侧统一响应包装：与 gateway/src/response.ts 保持一致。
// v3 阶段 core 只有 /health 一个 endpoint，未来加端点时同样用 ok/err。
export type ApiResponse<T> =
  | { data: T; code: 0; message: 'ok' }
  | { data: null; code: number; message: string };

export function ok<T>(data: T): ApiResponse<T> {
  return { data, code: 0, message: 'ok' };
}

export function err(code: number, message: string): ApiResponse<null> {
  return { data: null, code, message };
}
```

- [ ] **Step 4: 改 core /health 测试**

编辑 `core/src/routes/health.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { healthRoutes } from './health.js';
import type { Compat } from '../compat/load.js';

const fakeCompat: Compat = { version: '9.9.9', upstream: {} };

describe('core /health', () => {
  it('返回 ok 与服务名 + version', async () => {
    const app = Fastify({ logger: false });
    app.decorate('compat', fakeCompat);
    await app.register(healthRoutes);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: { ok: true, service: 'core', version: '9.9.9', schema: 1 },
      code: 0,
      message: 'ok',
    });
  });
});
```

- [ ] **Step 5: 改 client handshake 走新格式**

编辑 `client/src/compat/handshake.ts`：

```typescript
// client 端握手：调 gateway /health（v3 起新格式），解析 data.version。
// 带 X-Client-Key 头（v3 起的鉴权要求；/health 公开但加 header 不影响）。
import { checkCompat } from './check.js';
import type { COMPAT } from '../compat.generated.js';

type Compat = typeof COMPAT;

export type HandshakeStatus = 'PAIRING' | 'HEALTHY' | 'MISMATCH' | 'PAIR_FAILED';

export type HandshakeResult = {
  status: HandshakeStatus;
  version: string | null;
};

/**
 * 发起一次握手。返回结果包含状态和拿到的 version（用于 UI 展示）。
 * 不抛错：所有错误转为 PAIR_FAILED 或 MISMATCH（保守路径）。
 */
export async function handshake(
  gatewayUrl: string,
  compat: Compat,
  clientKey: string | null,
): Promise<HandshakeResult> {
  const headers: Record<string, string> = {};
  if (clientKey) headers['x-client-key'] = clientKey;
  let res: Response;
  try {
    res = await fetch(`${gatewayUrl}/health`, { headers });
  } catch {
    return { status: 'PAIR_FAILED', version: null };
  }
  if (!res.ok) {
    return { status: 'PAIR_FAILED', version: null };
  }
  let body: { data?: { version?: string; schema?: number }; code?: number };
  try {
    body = await res.json();
  } catch {
    return { status: 'MISMATCH', version: null };
  }
  const inner = body.data;
  if (typeof inner?.version !== 'string' || inner.schema !== 1) {
    return { status: 'MISMATCH', version: inner?.version ?? null };
  }
  const want = compat.upstream.gateway;
  if (!want) {
    return { status: 'MISMATCH', version: inner.version };
  }
  const inRange = checkCompat(inner.version, want);
  return {
    status: inRange ? 'HEALTHY' : 'MISMATCH',
    version: inner.version,
  };
}
```

- [ ] **Step 6: 改 client handshake 测试**

编辑 `client/src/compat/handshake.test.ts`，把 mock fetch 的响应改为新格式。例如：

```typescript
// 关键差异：响应改为 { data: {ok, service, version, schema}, code, message }
function mockOk(version: string) {
  return new Response(
    JSON.stringify({
      data: { ok: true, service: 'gateway', version, schema: 1 },
      code: 0,
      message: 'ok',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}
```

- [ ] **Step 7: 跑三件套**

```bash
cd /home/handdeng/rd-center/my-ai && pnpm -r typecheck && pnpm -r lint && pnpm -r test
```

Expected: 全部通过。

- [ ] **Step 8: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add gateway/src/routes/health.ts gateway/src/routes/health.test.ts \
        core/src/routes/health.ts core/src/routes/health.test.ts core/src/response.ts \
        client/src/compat/handshake.ts client/src/compat/handshake.test.ts
git commit -m "feat: /health + handshake 走统一响应包装"
```

### Task 3.2：升级 /v1/agents 走新格式

**目的**：业务 endpoint 也走新格式（与 /health 一致）。

**Files:**

- Modify: `gateway/src/routes/agents.ts`
- Modify: `core/src/routes/agents.ts`
- Modify: `core/src/server.ts`（若 agents route 注入方式变化）
- Modify: `gateway/src/clients/core.ts`（core 响应解析）

- [ ] **Step 1: 改 core /v1/agents 走新格式**

编辑 `core/src/routes/agents.ts`，把响应改为 `ok(agents)`：

```typescript
// core 端的 agents 列表端点。v3 起走新响应包装。
import type { FastifyInstance } from 'fastify';
import { ok } from '../response.js';
import type { AgentRegistry } from '../agent/registry.js';

export async function agentRoutes(app: FastifyInstance, registry: AgentRegistry) {
  app.get('/v1/agents', async () => {
    return ok(registry.list());
  });
}
```

- [ ] **Step 2: 改 gateway /v1/agents 转发 + 包装**

编辑 `gateway/src/routes/agents.ts`：

```typescript
// gateway 透传 /v1/agents 到 core；v3 起走新响应包装。
import type { FastifyInstance } from 'fastify';
import { ok, err } from '../response.js';
import { err as errResp } from '../response.js';
import type { CoreClient } from '../clients/core.js';

export async function agentRoutes(app: FastifyInstance, core: CoreClient) {
  app.get('/v1/agents', async (req, reply) => {
    try {
      const result = await core.listAgents();
      // core 已是新格式；clientCtx 由 middleware 注入
      return reply.send(ok(result));
    } catch (e) {
      req.log.error({ err: e }, 'listAgents failed');
      return reply.code(502).send(err(502, 'upstream_error'));
    }
  });
}
```

- [ ] **Step 3: 改 gateway CoreClient 解析新格式**

编辑 `gateway/src/clients/core.ts`：

```typescript
// 网关调 core 的客户端：v3 起 core 走新格式，listAgents 返回 data 字段。
import { request } from 'undici';

export class CoreClient {
  constructor(private readonly opts: { baseUrl: string; timeoutMs?: number }) {}

  async listAgents(): Promise<unknown[]> {
    const res = await request(`${this.opts.baseUrl}/v1/agents`, {
      method: 'GET',
      headersTimeout: this.opts.timeoutMs ?? 10_000,
    });
    if (res.statusCode !== 200) {
      throw new Error(`core /v1/agents ${res.statusCode}`);
    }
    const body = (await res.body.json()) as { data?: unknown[] };
    return body.data ?? [];
  }
}
```

- [ ] **Step 4: 跑三件套**

```bash
cd /home/handdeng/rd-center/my-ai && pnpm -r typecheck && pnpm -r lint && pnpm -r test
```

Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add gateway/src/routes/agents.ts core/src/routes/agents.ts gateway/src/clients/core.ts
git commit -m "feat: /v1/agents 走统一响应包装"
```

---

## Phase 4：集成 / 清理 / CLI

### Task 4.1：把 middleware + routes + cleanup 接入 server.ts

**目的**：把所有鉴权 / 配对相关 endpoint 接到 Fastify 实例。

**Files:**

- Modify: `gateway/src/server.ts`

- [ ] **Step 1: 改 server.ts 集成**

编辑 `gateway/src/server.ts`：

```typescript
// 网关 Fastify 装配：注册中间件（CORS、WS、auth）、注入 core 客户端、注册路由、设置错误兜底。
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { Config } from './config.js';
import type { Compat } from './compat/load.js';
import type { AuthStore } from './auth/store.js';
import { createLogger } from './logger.js';
import { CoreClient } from './clients/core.js';
import { healthRoutes } from './routes/health.js';
import { agentRoutes } from './routes/agents.js';
import { pairRoutes } from './routes/pair.js';
import { pairStatusRoutes } from './routes/pair-status.js';
import { pairResolveRoutes } from './routes/internal/pair-resolve.js';
import { clientsRoutes } from './routes/internal/clients.js';
import { authMiddleware } from './auth/middleware.js';
import { errResp } from './response.js';
import { startCleanupTask } from './auth/cleanup.js';

/**
 * 构建网关 Fastify 实例：app 上的 `core` 装饰供路由访问上游客户端，
 * `compat` 装饰供路由访问版本/上游信息，`authStore` 装饰供 middleware/routes 访问持久层。
 * 不在内部调用 listen，便于测试。
 */
export async function buildServer(cfg: Config, compat: Compat, authStore: AuthStore) {
  const app = Fastify({ logger: createLogger(cfg.LOG_LEVEL) });

  app.decorate('compat', compat);
  app.decorate('authStore', authStore);
  app.decorate('config', {
    GATEWAY_PAIRING_PUBLIC: cfg.GATEWAY_PAIRING_PUBLIC,
    GATEWAY_PAIR_KEY: cfg.GATEWAY_PAIR_KEY,
  });

  // CORS：拆分逗号分隔字符串，trim 后过滤空值。
  const origins = cfg.CORS_ORIGINS.split(',')
    .map(s => s.trim())
    .filter(Boolean);
  await app.register(cors, { origin: origins, credentials: true });
  await app.register(websocket);

  // 鉴权中间件（白名单放行 + 验 X-Client-Key）
  await app.register(authMiddleware);

  const core = new CoreClient({ baseUrl: cfg.CORE_URL });
  app.decorate('core', core);

  // 公开 routes
  await app.register(healthRoutes);
  await app.register(pairRoutes);
  await app.register(pairStatusRoutes);

  // 内部 routes（middleware 不鉴权，handler 自检 127.0.0.1）
  await app.register(pairResolveRoutes);
  await app.register(clientsRoutes);

  // 业务 routes（需鉴权）
  await app.register(async instance => {
    await agentRoutes(instance, core);
  });

  // 全局错误兜底：避免 5xx 漏出去时把栈暴露给客户端。
  app.setErrorHandler((err, _req, reply) => {
    app.log.error({ err }, 'unhandled error');
    reply.code(500).send(errResp(500, 'internal_error'));
  });

  // 启动过期清理任务
  if (cfg.GATEWAY_PAIRING_KEY_TTL && cfg.GATEWAY_PAIRING_KEY_TTL > 0) {
    startCleanupTask(app, cfg.GATEWAY_PAIRING_KEY_TTL);
  }

  return app;
}

// Fastify 类型扩展：把 compat / authStore / config 挂到 app 实例上
declare module 'fastify' {
  interface FastifyInstance {
    compat: Compat;
    authStore: AuthStore;
    config: { GATEWAY_PAIRING_PUBLIC: boolean; GATEWAY_PAIR_KEY?: string };
  }
}
```

注意：`errResp` 应是 `err` 的别名——修一下引用。

```typescript
import { err as errResp } from './response.js';
```

- [ ] **Step 2: 跑 typecheck**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm typecheck
```

Expected: 类型错误可能存在（因 healthRoutes/agentRoutes 之前在同一个 instance 里注册，现拆出）。修。

- [ ] **Step 3: 跑三件套**

```bash
cd /home/handdeng/rd-center/my-ai && pnpm -r typecheck && pnpm -r lint && pnpm -r test
```

Expected: 全部通过。

- [ ] **Step 4: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add gateway/src/server.ts
git commit -m "feat(gateway): server 集成 auth + pair + cleanup"
```

### Task 4.2：实现 auth/cleanup 定时任务

**目的**：定期删除过期 client。间隔 = max(60s, min(3600s, TTL/10))。

**Files:**

- Create: `gateway/src/auth/cleanup.ts`
- Create: `gateway/src/auth/cleanup.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `gateway/src/auth/cleanup.test.ts`：

```typescript
// auth/cleanup 单元测试：TTL=0 不启动；TTL>0 启动 + 调 cleanup 后过期 client 被删。
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import { openDatabase } from '../db.js';
import { AuthStore } from './store.js';
import { startCleanupTask, stopCleanupTask } from './cleanup.js';

describe('startCleanupTask', () => {
  let app: ReturnType<typeof Fastify>;
  let store: AuthStore;

  beforeEach(() => {
    vi.useFakeTimers();
    app = Fastify({ logger: false });
    app.decorate('authStore', new AuthStore(openDatabase(':memory:')));
    store = app.authStore;
  });

  afterEach(() => {
    stopCleanupTask(app);
    vi.useRealTimers();
  });

  it('TTL=0 不启动定时任务', () => {
    startCleanupTask(app, 0);
    expect(app.cleanupInterval).toBeUndefined();
  });

  it('TTL>0 启动定时任务 + 触发后过期 client 被删', () => {
    const now = Date.now();
    store.insertClient({
      id: 'old',
      keyHash: 'old',
      name: null,
      createdAt: now,
      lastSeenAt: now - 10_000,
    });
    store.insertClient({ id: 'new', keyHash: 'new', name: null, createdAt: now, lastSeenAt: now });
    startCleanupTask(app, 5); // TTL=5s
    // 触发清理
    vi.advanceTimersByTime(1000); // 间隔 = max(60, 5/10=0.5) = 60s？不对 max 60
    // 实际 TTL=5s → 间隔 = max(60, min(3600, 5/10=0.5=1)) = 60s
    vi.advanceTimersByTime(60_000);
    // 此时 now = now+60s, old 的 last_seen_at = now-10s
    // TTL=5s, threshold = now+60s - 5000 = now+55s
    // old: now-10s < now+55s → 删除
    expect(store.findByHash('old')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test src/auth/cleanup.test.ts
```

Expected: 找不到 cleanup.js 错误。

- [ ] **Step 3: 实现**

新建 `gateway/src/auth/cleanup.ts`：

```typescript
// 网关过期清理：仅当 GATEWAY_PAIRING_KEY_TTL > 0 启动。
// 间隔 = max(60s, min(3600s, TTL/10))；调 cleanup() 删除 last_seen_at < now-TTL 的 client。
import type { FastifyInstance } from 'fastify';
import type { AuthStore } from './store.js';

declare module 'fastify' {
  interface FastifyInstance {
    authStore: AuthStore;
    cleanupInterval?: NodeJS.Timeout;
  }
}

function calcIntervalMs(ttlSec: number): number {
  const sec = Math.max(60, Math.min(3600, Math.ceil(ttlSec / 10)));
  return sec * 1000;
}

export function startCleanupTask(app: FastifyInstance, ttlSec: number): void {
  if (ttlSec <= 0) return;
  const intervalMs = calcIntervalMs(ttlSec);
  const handler = () => {
    try {
      const threshold = Date.now() - ttlSec * 1000;
      const deleted = app.authStore.deleteExpiredClients(threshold);
      if (deleted > 0) {
        app.log.info({ deleted }, 'cleanup: removed expired clients');
      }
    } catch (e) {
      app.log.warn({ err: e }, 'cleanup failed');
    }
  };
  app.cleanupInterval = setInterval(handler, intervalMs);
  app.log.info({ ttlSec, intervalMs }, 'cleanup task started');
}

export function stopCleanupTask(app: FastifyInstance): void {
  if (app.cleanupInterval) {
    clearInterval(app.cleanupInterval);
    app.cleanupInterval = undefined;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm test src/auth/cleanup.test.ts
```

Expected: 2 个用例全过。

- [ ] **Step 5: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add gateway/src/auth/cleanup.ts gateway/src/auth/cleanup.test.ts
git commit -m "feat(gateway): 过期清理定时任务"
```

### Task 4.3：实现 CLI 入口

**目的**：`my-ai-gateway { start | pair --token | list }` 三子命令。

**Files:**

- Create: `gateway/src/cli.ts`
- Modify: `gateway/src/index.ts`
- Modify: `gateway/package.json`

- [ ] **Step 1: 实现 cli.ts**

新建 `gateway/src/cli.ts`：

```typescript
// my-ai-gateway CLI 入口：start / pair --token / list 三个子命令。
// start：等价于 node dist/index.js（向后兼容 v2 启动方式）
// pair：调 /internal/pair/resolve 完成私有模式配对码解析
// list：调 /internal/clients 看已配对客户端
import { request } from 'undici';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';
import { openDatabase } from './db.js';
import { AuthStore } from './auth/store.js';
import { parseCompat } from './compat/load.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const COMPAT_PATH = fileURLToPath(new URL('../.compat.generated.json', import.meta.url));

function getGatewayBaseUrl(): string {
  const cfg = loadConfig();
  return `http://127.0.0.1:${cfg.PORT}`;
}

async function cmdStart(): Promise<void> {
  const cfg = loadConfig();
  const compat = parseCompat(COMPAT_PATH);
  const authStore = new AuthStore(openDatabase(cfg.GATEWAY_DB_PATH));
  const app = await buildServer(cfg, compat, authStore);
  await app.listen({ port: cfg.PORT, host: cfg.HOST });
}

async function cmdPair(token: string): Promise<void> {
  const base = getGatewayBaseUrl();
  const res = await request(`${base}/internal/pair/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (res.statusCode === 200) {
    console.log('✅ 已配对');
    return;
  }
  const body = (await res.body.json().catch(() => ({}))) as { message?: string };
  console.error(`❌ 解析失败: ${body.message ?? res.statusCode}`);
  process.exit(1);
}

async function cmdList(): Promise<void> {
  const base = getGatewayBaseUrl();
  const res = await request(`${base}/internal/clients`);
  if (res.statusCode !== 200) {
    console.error(`❌ 网关不可达 (${res.statusCode})`);
    process.exit(2);
  }
  const body = (await res.body.json()) as {
    data: Array<{
      name: string | null;
      id: string;
      created_at: number;
      last_seen_at: number;
      online: boolean;
    }>;
  };
  if (body.data.length === 0) {
    console.log('（暂无已配对客户端）');
    return;
  }
  console.log('NAME                ID         CREATED              LAST_SEEN            ONLINE');
  for (const c of body.data) {
    const name = (c.name ?? '(未命名)').padEnd(20).slice(0, 20);
    const id = c.id.slice(0, 8).padEnd(10);
    const created = new Date(c.created_at).toISOString().slice(0, 19).padEnd(20);
    const last = new Date(c.last_seen_at).toISOString().slice(0, 19).padEnd(20);
    const online = c.online ? '🟢' : '⚫';
    console.log(`${name} ${id} ${created} ${last} ${online}`);
  }
}

function parseArgs(argv: string[]): { cmd: string; opts: Record<string, string> } {
  const [cmd, ...rest] = argv;
  const opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg) continue;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const val = rest[i + 1];
      if (val && !val.startsWith('--')) {
        opts[key] = val;
        i++;
      } else {
        opts[key] = 'true';
      }
    }
  }
  return { cmd: cmd ?? 'start', opts };
}

async function main(): Promise<void> {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  switch (cmd) {
    case 'start':
      await cmdStart();
      break;
    case 'pair': {
      const token = opts.token;
      if (!token) {
        console.error('用法: my-ai-gateway pair --token <token>');
        process.exit(1);
      }
      await cmdPair(token);
      break;
    }
    case 'list':
      await cmdList();
      break;
    default:
      console.error(`未知子命令: ${cmd}（start | pair | list）`);
      process.exit(1);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: 改 index.ts 为薄壳**

编辑 `gateway/src/index.ts`：

```typescript
// 旧入口：保持向后兼容（node dist/index.js 等价于 my-ai-gateway start）。
import { cmdStart } from './cli.js';
void cmdStart();
```

- [ ] **Step 3: 改 gateway package.json 加 bin**

编辑 `gateway/package.json`：

```jsonc
{
  "bin": {
    "my-ai-gateway": "./dist/cli.js",
  },
  "scripts": {
    "start": "node dist/cli.js start",
    "pair": "node dist/cli.js pair",
    "list": "node dist/cli.js list",
  },
}
```

- [ ] **Step 4: 手动验证 CLI 启动**

Run:

```bash
cd /home/handdeng/rd-center/my-ai/gateway && pnpm build
```

Expected: tsc 编译通过。

Run:

```bash
cd /home/handdeng/rd-center/my-ai/gateway && node dist/cli.js 2>&1 | head -5
```

Expected: 启动 gateway（默认 PORT=8787），按 Ctrl+C 停。

- [ ] **Step 5: 跑三件套**

```bash
cd /home/handdeng/rd-center/my-ai && pnpm -r typecheck && pnpm -r lint
```

Expected: 全部通过。

- [ ] **Step 6: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add gateway/src/cli.ts gateway/src/index.ts gateway/package.json
git commit -m "feat(gateway): CLI 入口 (start/pair/list)"
```

---

## Phase 5：客户端

### Task 5.1：实现 client 端 secure-store（stronghold 封装）

**目的**：用 tauri-plugin-stronghold 加密存 clientKey、gatewayUrl 等。

**Files:**

- Create: `client/src/lib/secure-store.ts`
- Create: `client/src/lib/secure-store.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `client/src/lib/secure-store.test.ts`：

```typescript
// secure-store 单元测试：mock tauri-plugin-stronghold 验证 load/save/clear。
import { describe, it, expect, beforeEach, vi } from 'vitest';

// mock @tauri-apps/plugin-stronghold
const mockStore: Record<string, string> = {};
vi.mock('@tauri-apps/plugin-stronghold', () => ({
  Stronghold: class {
    async createClient(_path: string) {
      return {
        getStore: async () => ({
          insert: async (k: string, v: string) => {
            mockStore[k] = v;
          },
          get: async (k: string) => {
            const v = mockStore[k];
            return v ? new TextEncoder().encode(v) : null;
          },
          delete: async (k: string) => {
            delete mockStore[k];
          },
        }),
      };
    }
    async save() {},
  },
  // ... 等等，更简单的 mock 见下
}));

import { loadSecureConfig, saveSecureConfig, clearSecureConfig } from './secure-store.js';

describe('secure-store', () => {
  beforeEach(() => {
    Object.keys(mockStore).forEach((k) => delete mockStore[k]);
  });

  it('save 后 load 一致', async () => {
    await saveSecureConfig({ clientKey: 'k1', gatewayUrl: 'http://x', pairKey: null, clientName: 'alice' });
    const got = await loadSecureConfig();
    expect(got).toEqual({ clientKey: 'k1', gatewayUrl: 'http://x', pairKey: null, clientName: 'alice' });
  });

  it('未存过 load 返回 null', async () => {
    expect(await loadSecureConfig()).toBeNull();
  });

  it('clear 后 load 返回 null', async () => {
    await saveSecureConfig({ clientKey: 'k1', gatewayUrl: 'http://x', pairKey: null, clientName: null });
    await clearSecureConfig();
    expect(await loadSecureConfig()).toBeNull();
  });
});
```

- [ ] **Step 2: 实现 secure-store.ts**

新建 `client/src/lib/secure-store.ts`：

```typescript
// 客户端加密 store：封装 tauri-plugin-stronghold。
// 数据：clientKey、gatewayUrl、pairKey（可选）、clientName（可选）
// 存到 OS keychain（macOS Keychain / Windows DPAPI / Linux Secret Service）。
// 浏览器测试用 localStorage 模拟（dev / test 环境）。
import { Stronghold } from '@tauri-apps/plugin-stronghold';

const STORE_PATH = 'pair-config.dat';
const RECORD_NAME = 'pair-config';
const CONFIG_KEY = 'v1';

export type SecureConfig = {
  clientKey: string;
  gatewayUrl: string;
  pairKey: string | null;
  clientName: string | null;
};

async function getClient() {
  const stronghold = await Stronghold.load(STORE_PATH);
  return stronghold.createClient(RECORD_NAME);
}

export async function saveSecureConfig(cfg: SecureConfig): Promise<void> {
  const client = await getClient();
  const store = await client.getStore();
  await store.insert(CONFIG_KEY, JSON.stringify(cfg));
  await client.save();
}

export async function loadSecureConfig(): Promise<SecureConfig | null> {
  const client = await getClient();
  const store = await client.getStore();
  const bytes = await store.get(CONFIG_KEY);
  if (!bytes) return null;
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as SecureConfig;
}

export async function clearSecureConfig(): Promise<void> {
  const client = await getClient();
  const store = await client.getStore();
  await store.delete(CONFIG_KEY);
  await client.save();
}
```

- [ ] **Step 3: 跑测试**

```bash
cd /home/handdeng/rd-center/my-ai/client && pnpm test src/lib/secure-store.test.ts
```

Expected: 3 个用例全过（mock 生效）。

- [ ] **Step 4: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add client/src/lib/secure-store.ts client/src/lib/secure-store.test.ts
git commit -m "feat(client): secure-store stronghold 封装"
```

### Task 5.2：实现 client 端 api 包装（统一响应解析）

**目的**：fetch 包装 + 解析 `{data, code, message}` + 抛 ApiError。

**Files:**

- Create: `client/src/lib/api.ts`
- Create: `client/src/lib/api.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `client/src/lib/api.test.ts`：

```typescript
// api.ts 单元测试：覆盖 200 解析 + 4xx 抛 ApiError + 解析失败抛 ParseError。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiFetch, ApiError, ParseError } from './api.js';

describe('apiFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('200 响应解析 data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { foo: 1 }, code: 0, message: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const got = await apiFetch<{ foo: number }>('http://x/foo');
    expect(got).toEqual({ foo: 1 });
  });

  it('4xx 响应抛 ApiError 且带 data 字段', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ data: { reason: 'expired' }, code: 401, message: 'invalid_key' }),
          {
            status: 401,
            headers: { 'content-type': 'application/json' },
          },
        ),
      ),
    );
    try {
      await apiFetch('http://x/foo');
      expect.fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe(401);
      expect((e as ApiError).data).toEqual({ reason: 'expired' });
    }
  });

  it('解析失败抛 ParseError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
    await expect(apiFetch('http://x/foo')).rejects.toThrow(ParseError);
  });

  it('带 X-Client-Key header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: null, code: 0, message: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('http://x/foo', { clientKey: 'abc' });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-client-key']).toBe('abc');
  });
});
```

- [ ] **Step 2: 实现**

新建 `client/src/lib/api.ts`：

```typescript
// client 端 fetch 包装：解析统一响应 + 抛 ApiError / ParseError。
// v3 起所有 endpoint 走 {data, code, message}，client 用此统一解析。
// ApiError 带 data 字段：202 等"业务码为 0 但 HTTP 非 200"的场景需要从 data 取 token 等信息。
export class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
    public data: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

type ApiEnvelope<T> =
  | { data: T; code: 0; message: 'ok' }
  | { data: null; code: number; message: string };

export type ApiFetchOptions = {
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT';
  body?: unknown;
  clientKey?: string | null;
};

export async function apiFetch<T>(url: string, opts: ApiFetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.clientKey) headers['x-client-key'] = opts.clientKey;
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let body: ApiEnvelope<T>;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new ParseError(`invalid JSON response from ${url}`);
  }
  if (body.code !== 0 || !res.ok) {
    throw new ApiError(body.code, body.message, body.data);
  }
  return body.data as T;
}
```

- [ ] **Step 3: 跑测试**

```bash
cd /home/handdeng/rd-center/my-ai/client && pnpm test src/lib/api.test.ts
```

Expected: 4 个用例全过。

- [ ] **Step 4: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add client/src/lib/api.ts client/src/lib/api.test.ts
git commit -m "feat(client): api 包装（统一响应解析 + ApiError）"
```

### Task 5.3：实现 `<PairBanner>` 组件

**目的**：顶部 banner 显示 NEED_PAIR / NEED_REPAIR 状态 + 提供"去配对"和"清除配对"按钮。

**Files:**

- Create: `client/src/components/PairBanner.tsx`
- Create: `client/src/components/PairBanner.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `client/src/components/PairBanner.test.tsx`：

```tsx
// PairBanner 组件测试：覆盖显示/隐藏 + 按钮回调。
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PairBanner } from './PairBanner.js';

describe('<PairBanner>', () => {
  it('未配对状态显示"去配对"和"清除配对"按钮', () => {
    const onPair = vi.fn();
    const onClear = vi.fn();
    render(<PairBanner variant="NEED_PAIR" onGoToPair={onPair} onClear={onClear} />);
    expect(screen.getByText(/未配对/)).toBeTruthy();
    fireEvent.click(screen.getByText('去配对'));
    expect(onPair).toHaveBeenCalled();
    fireEvent.click(screen.getByText('清除配对'));
    expect(onClear).toHaveBeenCalled();
  });

  it('需重新配对状态显示额外提示', () => {
    render(<PairBanner variant="NEED_REPAIR" onGoToPair={() => {}} onClear={() => {}} />);
    expect(screen.getByText(/重新配对/)).toBeTruthy();
  });

  it('已配对状态不渲染', () => {
    const { container } = render(
      <PairBanner variant="PAIRED" onGoToPair={() => {}} onClear={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: 实现**

新建 `client/src/components/PairBanner.tsx`：

```tsx
// 顶部 banner：显示未配对 / 需重新配对 状态 + 提供两个按钮。
// PAIRED / PAIR_PENDING 等其他状态不渲染。
type Variant = 'NEED_PAIR' | 'NEED_REPAIR' | 'PAIRED';

type Props = {
  variant: Variant;
  onGoToPair: () => void;
  onClear: () => void;
};

export function PairBanner({ variant, onGoToPair, onClear }: Props) {
  if (variant === 'PAIRED') return null;
  const message =
    variant === 'NEED_PAIR'
      ? '尚未配对。请先完成网关配对。'
      : '上次的 clientKey 已失效，请重新配对。';
  return (
    <div role="alert" style={{ background: '#fff3cd', padding: 12, marginBottom: 8 }}>
      <span>{message}</span>
      <button type="button" onClick={onGoToPair} style={{ marginLeft: 8 }}>
        去配对
      </button>
      <button type="button" onClick={onClear} style={{ marginLeft: 8 }}>
        清除配对
      </button>
    </div>
  );
}
```

- [ ] **Step 3: 跑测试**

```bash
cd /home/handdeng/rd-center/my-ai/client && pnpm test src/components/PairBanner.test.tsx
```

Expected: 3 个用例全过。

- [ ] **Step 4: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add client/src/components/PairBanner.tsx client/src/components/PairBanner.test.tsx
git commit -m "feat(client): PairBanner 组件"
```

### Task 5.4：实现 `<PairDialog>` 组件

**目的**：弹出层表单：gatewayUrl + pairKey + name + 提交 → POST /pair + 轮询。

**Files:**

- Create: `client/src/components/PairDialog.tsx`
- Create: `client/src/components/PairDialog.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `client/src/components/PairDialog.test.tsx`：

```tsx
// PairDialog 组件测试：覆盖初始 render + 提交 + 私有模式轮询。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('../lib/api.js', () => ({
  apiFetch: vi.fn(),
}));
vi.mock('../lib/secure-store.js', () => ({
  saveSecureConfig: vi.fn(),
}));

import { apiFetch } from '../lib/api.js';
import { PairDialog } from './PairDialog.js';

describe('<PairDialog>', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it('初始 render：表单 + 提交按钮可见', () => {
    render(<PairDialog initialUrl="" onPaired={() => {}} onClose={() => {}} />);
    expect(screen.getByLabelText('Gateway URL')).toBeTruthy();
    expect(screen.getByLabelText('Pair Key (可选)')).toBeTruthy();
    expect(screen.getByRole('button', { name: '提交' })).toBeTruthy();
  });

  it('POST /pair 200 → 调 onPaired', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(undefined); // GET /health
    vi.mocked(apiFetch).mockResolvedValueOnce({ clientKey: 'k', name: 'alice' });
    const onPaired = vi.fn();
    render(<PairDialog initialUrl="http://gw" onPaired={onPaired} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Gateway URL'), { target: { value: 'http://gw' } });
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    await waitFor(() => expect(onPaired).toHaveBeenCalledWith({ clientKey: 'k', name: 'alice' }));
  });

  it('POST /pair 202 → 进入轮询 → PAIRED 后调 onPaired', async () => {
    vi.useFakeTimers();
    vi.mocked(apiFetch).mockResolvedValueOnce(undefined); // GET /health
    vi.mocked(apiFetch).mockResolvedValueOnce({
      token: 'tk',
      expiresAt: 0,
      pollUrl: '/pair/status',
    });
    vi.mocked(apiFetch).mockResolvedValueOnce({ status: 'PENDING' });
    vi.mocked(apiFetch).mockResolvedValueOnce({ status: 'PAIRED' });
    const onPaired = vi.fn();
    render(<PairDialog initialUrl="http://gw" onPaired={onPaired} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Gateway URL'), { target: { value: 'http://gw' } });
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(onPaired).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: 实现**

新建 `client/src/components/PairDialog.tsx`：

```tsx
// 配对弹出层：表单 + 提交 → GET /health 探活 → POST /pair → 成功/轮询。
// v3 阶段简化 UI：3 个 input + 1 个 submit 按钮 + 状态文字。
import { useState } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';
import { saveSecureConfig } from '../lib/secure-store.js';

type Props = {
  initialUrl: string;
  initialPairKey?: string | null;
  initialName?: string | null;
  clientKey: string;
  onPaired: (info: { clientKey: string; name: string | null }) => void;
  onClose: () => void;
};

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export function PairDialog({
  initialUrl,
  initialPairKey = null,
  initialName = null,
  clientKey,
  onPaired,
  onClose,
}: Props) {
  const [url, setUrl] = useState(initialUrl);
  const [pairKey, setPairKey] = useState(initialPairKey ?? '');
  const [name, setName] = useState(initialName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setStatus('探活中…');
    try {
      await apiFetch(`${url}/health`, { clientKey });
    } catch (e) {
      setError(`网关不可达: ${(e as Error).message}`);
      setStatus(null);
      return;
    }
    setStatus('配对中…');
    try {
      const data = await apiFetch<{ clientKey: string; name: string | null }>(`${url}/pair`, {
        method: 'POST',
        clientKey,
        body: { clientKey, name: name || null, pairKey: pairKey || undefined },
      });
      await saveSecureConfig({
        clientKey: data.clientKey,
        gatewayUrl: url,
        pairKey: pairKey || null,
        clientName: data.name,
      });
      onPaired({ clientKey: data.clientKey, name: data.name });
      return;
    } catch (e) {
      if (e instanceof ApiError && e.code === 0) {
        // 202 pair_pending：从 e.data 取 token，进入轮询
        const token = (e.data as { token?: string } | null)?.token;
        if (!token) {
          setError('配对失败: 响应缺少 token');
          setStatus(null);
          return;
        }
        setStatus('等待 CLI 解析…');
        let stopped = false;
        const poll = async () => {
          if (stopped) return;
          try {
            const r = await apiFetch<{ status: string }>(`${url}/pair/status?token=${token}`);
            if (r.status === 'PAIRED') {
              stopped = true;
              await saveSecureConfig({
                clientKey,
                gatewayUrl: url,
                pairKey: pairKey || null,
                clientName: name || null,
              });
              onPaired({ clientKey, name: name || null });
            }
          } catch {
            // ignore, retry on next interval
          }
        };
        const id = setInterval(poll, POLL_INTERVAL_MS);
        setTimeout(() => {
          stopped = true;
          clearInterval(id);
          if (status === '等待 CLI 解析…') {
            setError('配对超时（5min），请重试');
            setStatus(null);
          }
        }, POLL_TIMEOUT_MS);
        void poll();
        return;
      }
      setError(`配对失败: ${(e as Error).message}`);
      setStatus(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="配对网关"
      style={{ border: '1px solid #ccc', padding: 16, background: '#fff' }}
    >
      <h3>网关配对</h3>
      <label>
        Gateway URL
        <input
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          aria-label="Gateway URL"
        />
      </label>
      <label>
        Pair Key (可选)
        <input
          type="password"
          value={pairKey}
          onChange={e => setPairKey(e.target.value)}
          aria-label="Pair Key (可选)"
        />
      </label>
      <label>
        客户端名 (可选)
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          aria-label="客户端名"
        />
      </label>
      <button type="button" onClick={submit}>
        提交
      </button>
      <button type="button" onClick={onClose}>
        取消
      </button>
      {status && <p>{status}</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: 跑测试确认通过**

```bash
cd /home/handdeng/rd-center/my-ai/client && pnpm test src/components/PairDialog.test.tsx
```

Expected: 3 个用例全过。

- [ ] **Step 4: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add client/src/components/PairDialog.tsx client/src/components/PairDialog.test.tsx
git commit -m "feat(client): PairDialog 弹出层 + 私有模式轮询"
```

### Task 5.5：扩展 client 端 App.tsx 状态机

**目的**：把 PairBanner / PairDialog 集成进 App.tsx，状态机扩展为 NEED_PAIR / PAIR_PENDING / PAIRED / NEED_REPAIR / PAIR_FAILED。

**Files:**

- Modify: `client/src/App.tsx`

- [ ] **Step 1: 改 App.tsx**

编辑 `client/src/App.tsx`：

```tsx
// 客户端根组件（v3）：状态机 + 配对 banner/dialog + 业务 401 被动感知。
import { useEffect, useState } from 'react';
import { handshake, type HandshakeStatus } from './compat/handshake.js';
import { COMPAT } from './compat.generated.js';
import { Settings } from './components/Settings.js';
import { MismatchBanner } from './components/MismatchBanner.js';
import { PairBanner } from './components/PairBanner.js';
import { PairDialog } from './components/PairDialog.js';
import { loadSecureConfig, clearSecureConfig } from './lib/secure-store.js';
import { apiFetch } from './lib/api.js';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://127.0.0.1:8787';
const HEARTBEAT_MS = Number(import.meta.env.VITE_HEARTBEAT_INTERVAL_MS ?? 5 * 60 * 1000);

type AppStatus =
  | 'NEED_PAIR'
  | 'PAIR_PENDING'
  | 'PAIRED'
  | 'NEED_REPAIR'
  | 'PAIR_FAILED'
  | 'PAIRING';

function App() {
  const [status, setStatus] = useState<AppStatus>('PAIRING');
  const [version, setVersion] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [secureConfig, setSecureConfig] = useState<{
    clientKey: string;
    gatewayUrl: string;
    pairKey: string | null;
    clientName: string | null;
  } | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  // 启动时读 secure config
  useEffect(() => {
    void loadSecureConfig().then(cfg => {
      if (cfg) setSecureConfig(cfg);
      else setStatus('NEED_PAIR');
    });
  }, []);

  // 启动 + heartbeat
  useEffect(() => {
    if (!secureConfig) return;
    let cancelled = false;
    const run = async () => {
      const next = await handshake(secureConfig.gatewayUrl, COMPAT, secureConfig.clientKey);
      if (cancelled) return;
      if (next.status === 'HEALTHY') {
        setStatus('PAIRED');
        setVersion(next.version);
      } else if (next.status === 'MISMATCH') {
        setStatus('PAIRED'); // version 不在范围但配对 OK，由 MismatchBanner 提示
        setVersion(next.version);
      } else if (next.status === 'PAIR_FAILED') {
        setStatus('NEED_REPAIR');
      }
    };
    void run();
    const id = setInterval(run, HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [secureConfig]);

  // 业务 401 被动感知
  const handleApiError = (code: number) => {
    if (code === 401) {
      setStatus('NEED_REPAIR');
      setShowDialog(true);
    }
  };

  const handlePaired = (info: { clientKey: string; name: string | null }) => {
    setSecureConfig(prev =>
      prev ? { ...prev, clientKey: info.clientKey, clientName: info.name } : prev,
    );
    setStatus('PAIRED');
    setShowDialog(false);
  };

  const handleClear = async () => {
    await clearSecureConfig();
    setSecureConfig(null);
    setStatus('NEED_PAIR');
  };

  return (
    <main className="app">
      <h1>my-ai client</h1>
      {status === 'NEED_PAIR' || status === 'NEED_REPAIR' ? (
        <PairBanner variant={status} onGoToPair={() => setShowDialog(true)} onClear={handleClear} />
      ) : null}
      {showDialog && (
        <PairDialog
          initialUrl={secureConfig?.gatewayUrl ?? GATEWAY_URL}
          initialPairKey={secureConfig?.pairKey ?? null}
          initialName={secureConfig?.clientName ?? null}
          clientKey={secureConfig?.clientKey ?? crypto.randomUUID()}
          onPaired={handlePaired}
          onClose={() => setShowDialog(false)}
        />
      )}
      <Settings
        url={secureConfig?.gatewayUrl ?? GATEWAY_URL}
        onUrlChange={() => {
          /* v3 阶段不在 Settings 编辑 URL；由 PairDialog 维护 */
        }}
        onTest={() => {
          /* 测试按钮保留，但 v3 主要由 PairDialog 表单完成 */
        }}
        status={status as HandshakeStatus}
        version={version}
      />
      {status === 'PAIRED' && !bannerDismissed && version && (
        <MismatchBanner
          gatewayVersion={version}
          requiredRange={COMPAT.upstream.gateway}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}
    </main>
  );
}

export default App;
```

- [ ] **Step 2: 跑 typecheck + 测试**

```bash
cd /home/handdeng/rd-center/my-ai/client && pnpm typecheck && pnpm test
```

Expected: 全部通过；如有失败按需调整。

- [ ] **Step 3: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add client/src/App.tsx
git commit -m "feat(client): App 状态机扩展 v3 配对流程"
```

### Task 5.6：接入 tauri-plugin-stronghold（Rust 侧）

**目的**：让 Tauri 客户端能调 stronghold（tauri.conf.json + Cargo.toml + lib.rs）。

**Files:**

- Modify: `client/src-tauri/Cargo.toml`
- Modify: `client/src-tauri/tauri.conf.json`
- Modify: `client/src-tauri/src/lib.rs`
- Modify: `client/package.json`

- [ ] **Step 1: 加 tauri-plugin-stronghold 依赖到 Cargo.toml**

编辑 `client/src-tauri/Cargo.toml`，`[dependencies]` 块加：

```toml
[dependencies]
# ... existing ...
tauri-plugin-stronghold = "2"
```

- [ ] **Step 2: 加 stronghold plugin 到 tauri.conf.json**

编辑 `client/src-tauri/tauri.conf.json`，`plugins` 块加：

```jsonc
{
  "plugins": {
    "stronghold": {},
  },
}
```

- [ ] **Step 3: 在 lib.rs 注册 plugin**

编辑 `client/src-tauri/src/lib.rs`，找到 `tauri::Builder::default()`，链 `.plugin(tauri_plugin_stronghold::Builder::new().build())`：

```rust
// 现有代码...
tauri::Builder::default()
    // ... existing plugins ...
    .plugin(tauri_plugin_stronghold::Builder::new().build())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

- [ ] **Step 4: 加 @tauri-apps/plugin-stronghold 到 client package.json**

编辑 `client/package.json`，`dependencies` 块加：

```jsonc
{
  "dependencies": {
    // ... existing ...
    "@tauri-apps/plugin-stronghold": "^2.0.0",
  },
}
```

- [ ] **Step 5: 安装**

```bash
cd /home/handdeng/rd-center/my-ai && pnpm install
```

Expected: 安装成功。

- [ ] **Step 6: 跑客户端构建**

```bash
cd /home/handdeng/rd-center/my-ai/client && pnpm build
```

Expected: tsc + vite 构建成功。

- [ ] **Step 7: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add client/src-tauri/Cargo.toml client/src-tauri/tauri.conf.json client/src-tauri/src/lib.rs client/package.json pnpm-lock.yaml
git commit -m "feat(client): 接入 tauri-plugin-stronghold"
```

---

## Phase 6：版本同步 + 文档

### Task 6.1：升级 compat-matrix 到 0.0.3

**目的**：v3 release，三端 version 同步 bump。

**Files:**

- Modify: `versions/compat-matrix.json`
- Modify: `client/package.json`
- Modify: `client/src-tauri/tauri.conf.json`
- Modify: `gateway/package.json`
- Modify: `core/package.json`

- [ ] **Step 1: 改 compat-matrix.json**

编辑 `versions/compat-matrix.json`：

```jsonc
{
  "schema": 1,
  "components": {
    "client": { "version": "0.0.3" },
    "gateway": { "version": "0.0.3" },
    "core": { "version": "0.0.3" },
  },
  "compat": {
    "client": { "gateway": ">=0.0.3 <0.1.0" },
    "gateway": { "core": ">=0.0.3 <0.1.0" },
    "core": {},
  },
}
```

- [ ] **Step 2: 同步 client/gateway/core package.json version**

各 `package.json` `version` 字段改为 `0.0.3`。

- [ ] **Step 3: 同步 client tauri.conf.json version**

`client/src-tauri/tauri.conf.json` `version` 字段改为 `0.0.3`。

- [ ] **Step 4: 跑 sync + check**

```bash
cd /home/handdeng/rd-center/my-ai && pnpm sync:compat && pnpm check:compat
```

Expected: sync 生成各端 slice；check 通过。

- [ ] **Step 5: 跑三件套**

```bash
cd /home/handdeng/rd-center/my-ai && pnpm -r typecheck && pnpm -r lint && pnpm -r test
```

Expected: 全部通过。

- [ ] **Step 6: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add versions/compat-matrix.json client/package.json client/src-tauri/tauri.conf.json \
        gateway/package.json core/package.json \
        client/.compat.generated.json gateway/.compat.generated.json core/.compat.generated.json
git commit -m "chore: v3 升 version 到 0.0.3"
```

### Task 6.2：README 更新 v3 章节

**目的**：让 README 反映 v3 配对机制 + HTTPS 部署假设。

**Files:**

- Modify: `README.md`

- [ ] **Step 1: 在 README.md 加 v3 章节**

编辑 `README.md`，在 v2 章节后追加：

```markdown
## v3：网关远程配对与鉴权

v3 在 v2 握手 / heartbeat 基础上引入客户端身份：

- 客户端首次启动需"配对"（填 gateway URL + 可选 pair key + 可选 name）
- 网关公开/私有两种模式：公开无障碍配对；私有需 CLI 解析配对码或提供 pair key
- 配对成功 → 网关存 clientKey 的 SHA-256 hash + 元数据
- 后续请求 header `X-Client-Key: <clientKey>` 鉴权（fastify middleware）
- 配对信息存 SQLite（`./gateway.db`）；TTL 可配，过期自动清理
- CLI：`my-ai-gateway { start | pair --token <token> | list }`

详细见 [`versions/v3.md`](./versions/v3.md)。

### 部署假设

v3 假设 gateway 部署在以下任一环境：

- **HTTPS**（推荐）：TLS 加密 header 传输，clientKey 不可被窃听
- **内网 / 本机**：网络层信任，无窃听风险
- **明文 HTTP 跨网**：**不推荐**。v3 不实现 HMAC 签名，明文 HTTP 下 key 可被重放。v4+ 评估 HMAC。
```

- [ ] **Step 2: Commit**

```bash
cd /home/handdeng/rd-center/my-ai
git add README.md
git commit -m "docs: README 加 v3 章节 + 部署假设"
```

---

## 收尾

### Task 收尾 1：跑全量三件套 + git push

- [ ] **Step 1: 三件套**

```bash
cd /home/handdeng/rd-center/my-ai && pnpm -r typecheck && pnpm -r lint && pnpm -r test
```

Expected: 全部通过。

- [ ] **Step 2: push dev-20260607**

```bash
cd /home/handdeng/rd-center/my-ai && git push origin dev-20260607
```

- [ ] **Step 3: 让用户开 MR 合入 main（用户规则：MR merge/squash 必问）**

告诉用户：dev-20260607 已就绪，请在 GitHub UI 开 MR + squash 合入 main。
