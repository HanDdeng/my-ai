# v2 — 三端版本同步与兼容机制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在仓库内落地 `versions/v2.md` 描述的版本同步与兼容机制：顶层 matrix 作为 source of truth，build-time 同步到各子项目，运行时握手检测不匹配，CI 强制 version bump，GitHub Release 自动化出包。

**Architecture:** 顶层 `versions/compat-matrix.json` 是 source of truth；`scripts/sync-compat.mjs` build-time 切出各端 slice；`/health` 端点扩展 `version` + `schema`；client 跑"pairing → handshake → 5 min heartbeat"状态机；CI 用 3 个独立 job 强制 matrix 合规、version bump、必要时出 release。

**Tech Stack:** Node 24 + pnpm 10 workspaces、TypeScript 5.5+、semver 7、vitest 2、GitHub Actions、@tauri-apps/cli 2、conventional commits（commitlint）。

**Spec:** [`versions/v2.md`](../../../versions/v2.md)

---

## 总览：7 个 Phase，26 个 Task

| Phase                     | 内容                                                             | Task 数 |
| ------------------------- | ---------------------------------------------------------------- | ------- |
| 0. 共享依赖               | semver 进 catalog，三端安装                                      | 1       |
| 1. 顶层数据 + 工具        | matrix 文件 + sync/check 脚本 + 钩子                             | 5       |
| 2. core 层 (canonical)    | check + load + /health + 启动 fail-fast                          | 4       |
| 3. gateway 层 (镜像 core) | check + load + /health                                           | 2       |
| 4. client 层              | check + handshake + Banner + Settings + App 集成                 | 6       |
| 5. CI 校验                | compat-matrix-check / version-bump-check / release 三个 workflow | 3       |
| 6. Release 工具 + 首发    | release-notes 脚本 + 触发首次 release 验证                       | 2       |
| 7. 手工 E2E               | 跨三端真实装包冒烟                                               | 1       |
| 8. 收尾                   | git push + 文档回链                                              | 2       |

**约束**：每 task 完成后跑 `pnpm -r typecheck && pnpm -r lint && pnpm -r test` 三件套，全绿才能 commit。失败回退到上一个 commit。

---

## Phase 0：共享依赖

### Task 0.1：把 `semver` 加入 pnpm catalog 并安装到三端

**目的**：让 `checkCompat` 在 client / gateway / core 三端都能用同一个 semver 实现。

**Files:**

- Modify: `pnpm-workspace.yaml`
- Modify: `client/package.json`
- Modify: `gateway/package.json`
- Modify: `core/package.json`

- [ ] **Step 1: 在 pnpm-workspace.yaml 的 catalog 块加 `semver`**

编辑 `/home/handdeng/rd-center/my-ai/pnpm-workspace.yaml`，在 `catalog:` 块末尾追加：

```yaml
catalog:
  # ... existing entries ...

  # 用于版本范围匹配（v2 compat 机制）
  semver: ^7.6.3
```

- [ ] **Step 2: 在三个子项目 package.json 加 `semver: catalog:` 依赖**

`client/package.json` `dependencies` 块加：

```json
"dependencies": {
  // ... existing ...
  "semver": "catalog:"
}
```

`gateway/package.json` `dependencies` 块加：

```json
"dependencies": {
  // ... existing ...
  "semver": "catalog:"
}
```

`core/package.json` `dependencies` 块加：

```json
"dependencies": {
  // ... existing ...
  "semver": "catalog:"
}
```

- [ ] **Step 3: 跑 pnpm install**

Run: `pnpm install`
Expected: 安装成功，无 peer dep 警告（semver 无 peer）

- [ ] **Step 4: 验证三端都能 import semver**

Run:

```bash
cd client && node -e "import('semver').then(m => console.log(m.valid('2.0.0')))"
cd ../gateway && node -e "import('semver').then(m => console.log(m.valid('2.0.0')))"
cd ../core && node -e "import('semver').then(m => console.log(m.valid('2.0.0')))"
cd ..
```

Expected: 三行都输出 `2.0.0`（valid 返回原字符串）

- [ ] **Step 5: 跑三件套**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: 全部 PASS（未动业务代码，应无变化）

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml client/package.json gateway/package.json core/package.json pnpm-lock.yaml
git commit -m "build: 加入 semver 到 catalog（v2 compat 准备）"
```

---

## Phase 1：顶层数据 + 工具

### Task 1.1：创建 `versions/compat-matrix.json` v2.0.0 baseline

**目的**：在仓库根的 versions/ 目录建立 compat-matrix.json 作为 source of truth；初始 v2.0.0 baseline 三个组件同版本。

**Files:**

- Create: `versions/compat-matrix.json`

- [ ] **Step 1: 创建文件**

新建 `/home/handdeng/rd-center/my-ai/versions/compat-matrix.json`：

```json
{
  "schema": 1,
  "components": {
    "client": { "version": "2.0.0" },
    "gateway": { "version": "2.0.0" },
    "core": { "version": "2.0.0" }
  },
  "compat": {
    "client": { "gateway": ">=2.0.0 <3.0.0" },
    "gateway": { "core": ">=2.0.0 <3.0.0" },
    "core": {}
  }
}
```

- [ ] **Step 2: 验证 JSON 合法**

Run: `node -e "console.log(JSON.parse(require('fs').readFileSync('versions/compat-matrix.json','utf8')).schema)"`
Expected: 输出 `1`

- [ ] **Step 3: 验证 semver range 合法**

Run: `node -e "const s=require('semver'); const m=JSON.parse(require('fs').readFileSync('versions/compat-matrix.json','utf8')); for (const [d,u] of Object.entries(m.compat)) for (const [up,r] of Object.entries(u)) console.log(d, up, r, s.validRange(r) ? 'OK' : 'INVALID');"`
Expected: 三行都输出 `OK`

- [ ] **Step 4: Commit**

```bash
git add versions/compat-matrix.json
git commit -m "feat(compat): 引入 versions/compat-matrix.json 作为版本兼容 source of truth"
```

---

### Task 1.2：写 `scripts/check-compat-matrix.mjs`（TDD）

**目的**：CI 跑此脚本校验 matrix 文件的 schema 合规性；失败时非零退出。

**Files:**

- Create: `scripts/check-compat-matrix.test.mjs`
- Create: `scripts/check-compat-matrix.mjs`

- [ ] **Step 1: 写失败的测试**

新建 `/home/handdeng/rd-center/my-ai/scripts/check-compat-matrix.test.mjs`：

```js
import { describe, it, expect } from 'vitest';
import { checkMatrix } from './check-compat-matrix.mjs';

const baseMatrix = {
  schema: 1,
  components: {
    client: { version: '2.0.0' },
    gateway: { version: '2.0.0' },
    core: { version: '2.0.0' },
  },
  compat: {
    client: { gateway: '>=2.0.0 <3.0.0' },
    gateway: { core: '>=2.0.0 <3.0.0' },
    core: {},
  },
};

describe('checkMatrix', () => {
  it('合法 matrix 返回 null（无错误）', () => {
    expect(checkMatrix(baseMatrix)).toBeNull();
  });

  it('缺 schema 字段 → 返回错误信息', () => {
    const m = structuredClone(baseMatrix);
    delete m.schema;
    expect(checkMatrix(m)).toMatch(/schema/);
  });

  it('schema 不是 1 → 返回错误信息', () => {
    const m = structuredClone(baseMatrix);
    m.schema = 2;
    expect(checkMatrix(m)).toMatch(/schema/);
  });

  it('缺 components → 返回错误信息', () => {
    const m = structuredClone(baseMatrix);
    delete m.components;
    expect(checkMatrix(m)).toMatch(/components/);
  });

  it('components 缺 client/gateway/core → 返回错误信息', () => {
    const m = structuredClone(baseMatrix);
    m.components = { foo: { version: '1.0.0' } };
    expect(checkMatrix(m)).toMatch(/client/);
  });

  it('compat 引用不存在的组件 → 返回错误信息', () => {
    const m = structuredClone(baseMatrix);
    m.compat.gateway.core = '>=1.0.0';
    m.components = { client: { version: '1.0.0' } };
    expect(checkMatrix(m)).toMatch(/core/);
  });

  it('compat range 不是合法 semver range → 返回错误信息', () => {
    const m = structuredClone(baseMatrix);
    m.compat.client.gateway = 'not-a-range';
    expect(checkMatrix(m)).toMatch(/semver/);
  });
});
```

- [ ] **Step 2: 跑测试看是否失败**

Run: `pnpm exec vitest run scripts/check-compat-matrix.test.mjs`
Expected: FAIL with "Cannot find module './check-compat-matrix.mjs'"（模块不存在）

- [ ] **Step 3: 实现脚本**

新建 `/home/handdeng/rd-center/my-ai/scripts/check-compat-matrix.mjs`：

```js
#!/usr/bin/env node
// CI 校验：versions/compat-matrix.json 必须满足 schema 1 规则。
// 任一检查失败即非零退出，并把第一个错误打印到 stderr。
import semver from 'semver';

const REQUIRED_COMPONENTS = ['client', 'gateway', 'core'];

/**
 * 校验 matrix 对象。返回 null 表示通过；返回字符串表示第一个错误。
 */
export function checkMatrix(matrix) {
  if (!matrix || typeof matrix !== 'object') {
    return 'matrix 不是对象';
  }
  if (matrix.schema !== 1) {
    return `schema 必须是 1，当前为 ${matrix.schema}`;
  }
  if (!matrix.components || typeof matrix.components !== 'object') {
    return '缺 components 字段';
  }
  for (const name of REQUIRED_COMPONENTS) {
    if (!matrix.components[name]) {
      return `components 缺 ${name}`;
    }
  }
  if (!matrix.compat || typeof matrix.compat !== 'object') {
    return '缺 compat 字段';
  }
  for (const [downstream, upstreamMap] of Object.entries(matrix.compat)) {
    if (!matrix.components[downstream]) {
      return `compat 引用的下游 ${downstream} 不在 components 里`;
    }
    for (const [upstream, range] of Object.entries(upstreamMap)) {
      if (!matrix.components[upstream]) {
        return `compat.${downstream}.${upstream} 引用了不存在的组件 ${upstream}`;
      }
      if (!semver.validRange(range)) {
        return `compat.${downstream}.${upstream} 的 range "${range}" 不是合法 semver range`;
      }
    }
  }
  return null;
}

// CLI 入口：仅当作为主模块运行时执行
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  import('node:fs').then(async ({ readFileSync }) => {
    const path = process.argv[2] ?? 'versions/compat-matrix.json';
    let matrix;
    try {
      matrix = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      console.error(`✖ 读取 ${path} 失败: ${e.message}`);
      process.exit(1);
    }
    const err = checkMatrix(matrix);
    if (err) {
      console.error(`✖ ${err}`);
      process.exit(1);
    }
    console.log(`✓ ${path} 通过 schema 1 校验`);
  });
}
```

- [ ] **Step 4: 跑测试看是否通过**

Run: `pnpm exec vitest run scripts/check-compat-matrix.test.mjs`
Expected: 7 个用例全 PASS

- [ ] **Step 5: CLI 入口冒烟**

Run: `node scripts/check-compat-matrix.mjs versions/compat-matrix.json`
Expected: `✓ versions/compat-matrix.json 通过 schema 1 校验`

再跑：临时改 matrix 把 `client.compat.gateway` 改成 `"not-a-range"`，跑同样命令，期望 exit 1 + `✖ compat.client.gateway 的 range "not-a-range" 不是合法 semver range`。改回后再跑一次确认通过。

- [ ] **Step 6: 跑三件套确认无回归**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: 全 PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/check-compat-matrix.mjs scripts/check-compat-matrix.test.mjs
git commit -m "feat(compat): 新增 compat-matrix schema 校验脚本（CI 用）"
```

---

### Task 1.3：写 `scripts/sync-compat.mjs`（TDD）

**目的**：build-time 同步脚本，从顶层 matrix 切出各端 slice，写到子项目内。client 写 TS 注入，gateway / core 写 JSON 运行时读。

**Files:**

- Create: `scripts/sync-compat.test.mjs`
- Create: `scripts/sync-compat.mjs`

- [ ] **Step 1: 写失败的测试**

新建 `/home/handdeng/rd-center/my-ai/scripts/sync-compat.test.mjs`：

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SCRIPT_SRC = join(process.cwd(), 'scripts/sync-compat.mjs');

const baseMatrix = {
  schema: 1,
  components: {
    client: { version: '2.0.0' },
    gateway: { version: '2.0.0' },
    core: { version: '2.0.0' },
  },
  compat: {
    client: { gateway: '>=2.0.0 <3.0.0' },
    gateway: { core: '>=2.0.0 <3.0.0' },
    core: {},
  },
};

describe('sync-compat.mjs', () => {
  let workdir;
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'sync-compat-'));
  });
  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  /**
   * 在临时 workdir 下构造最小项目结构（gateway/、core/、client/src/、versions/），
   * 把仓库根的 sync-compat.mjs 复制到 workdir 根，写入指定 matrix，跑脚本。
   * 返回 workdir 路径。
   */
  function setupAndRun(matrix) {
    for (const d of ['gateway', 'core', 'client/src', 'versions']) {
      execFileSync('mkdir', ['-p', join(workdir, d)]);
    }
    writeFileSync(join(workdir, 'versions/compat-matrix.json'), JSON.stringify(matrix));
    copyFileSync(SCRIPT_SRC, join(workdir, 'sync-compat.mjs'));
    execFileSync('node', ['sync-compat.mjs'], { cwd: workdir });
    return workdir;
  }

  it('正确写出 gateway / core 的 .compat.generated.json', () => {
    setupAndRun(baseMatrix);

    const gw = JSON.parse(readFileSync(join(workdir, 'gateway/.compat.generated.json'), 'utf8'));
    expect(gw).toEqual({ version: '2.0.0', upstream: { core: '>=2.0.0 <3.0.0' } });

    const co = JSON.parse(readFileSync(join(workdir, 'core/.compat.generated.json'), 'utf8'));
    expect(co).toEqual({ version: '2.0.0', upstream: {} });
  });

  it('正确写出 client 的 compat.generated.ts（TS 注入）', () => {
    setupAndRun(baseMatrix);

    const ts = readFileSync(join(workdir, 'client/src/compat.generated.ts'), 'utf8');
    expect(ts).toContain('export const COMPAT');
    expect(ts).toContain('"version": "2.0.0"');
    expect(ts).toContain('"gateway": ">=2.0.0 <3.0.0"');
  });

  it('schema 不是 1 → 进程退出 1', () => {
    const badMatrix = structuredClone(baseMatrix);
    badMatrix.schema = 2;
    expect(() => setupAndRun(badMatrix)).toThrow();
  });

  it('缺 compat 字段 → 该端 upstream 为空对象', () => {
    const partialMatrix = structuredClone(baseMatrix);
    delete partialMatrix.compat.core;
    setupAndRun(partialMatrix);

    const co = JSON.parse(readFileSync(join(workdir, 'core/.compat.generated.json'), 'utf8'));
    expect(co).toEqual({ version: '2.0.0', upstream: {} });
  });
});
```

- [ ] **Step 2: 跑测试看是否失败**

Run: `pnpm exec vitest run scripts/sync-compat.test.mjs`
Expected: FAIL with "Cannot find module './sync-compat.mjs'"

- [ ] **Step 3: 实现脚本**

新建 `/home/handdeng/rd-center/my-ai/scripts/sync-compat.mjs`：

```js
#!/usr/bin/env node
// 从 versions/compat-matrix.json 切出各端 slice，build-time 同步。
// - gateway / core → 写 .compat.generated.json（运行时 fs.readFileSync 读）
// - client          → 写 src/compat.generated.ts（编译时 import）
//
// 由各子项目 predev / prebuild 钩子触发；dev 期间改了 matrix 也立即生效。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const MATRIX_PATH = 'versions/compat-matrix.json';

function readMatrix() {
  let raw;
  try {
    raw = readFileSync(MATRIX_PATH, 'utf8');
  } catch (e) {
    throw new Error(`读取 ${MATRIX_PATH} 失败: ${e.message}`);
  }
  const matrix = JSON.parse(raw);
  if (matrix.schema !== 1) {
    throw new Error(`不支持的 compat-matrix schema: ${matrix.schema}（当前仅支持 1）`);
  }
  return matrix;
}

/**
 * 把单端 slice 写到目标路径。返回写入的相对路径。
 */
function writeSlice(name, slice) {
  if (name === 'client') {
    const dst = resolve('client/src/compat.generated.ts');
    mkdirSync(dirname(dst), { recursive: true });
    const body = [
      '// 自动生成，请勿手改（predev / prebuild 钩子覆盖）',
      '// 来源：versions/compat-matrix.json',
      `export const COMPAT = ${JSON.stringify(slice, null, 2)} as const;`,
      '',
    ].join('\n');
    writeFileSync(dst, body);
    return 'client/src/compat.generated.ts';
  }
  const dst = resolve(name, '.compat.generated.json');
  writeFileSync(dst, JSON.stringify(slice, null, 2) + '\n');
  return `${name}/.compat.generated.json`;
}

export function syncAll() {
  const matrix = readMatrix();
  const { components, compat } = matrix;
  const written = [];
  for (const [name, info] of Object.entries(components)) {
    const slice = {
      version: info.version,
      upstream: compat[name] ?? {},
    };
    written.push(writeSlice(name, slice));
  }
  return written;
}

// CLI 入口
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  try {
    const written = syncAll();
    for (const p of written) console.log(`✓ ${p}`);
  } catch (e) {
    console.error(`✖ ${e.message}`);
    process.exit(1);
  }
}
```

- [ ] **Step 4: 跑测试看是否通过**

Run: `pnpm exec vitest run scripts/sync-compat.test.mjs`
Expected: 全 PASS

- [ ] **Step 5: CLI 入口冒烟（在仓库根跑）**

Run: `node scripts/sync-compat.mjs`
Expected:

```
✓ client/src/compat.generated.ts
✓ gateway/.compat.generated.json
✓ core/.compat.generated.json
```

验证三个文件实际生成：Run: `cat client/src/compat.generated.ts && echo "---" && cat gateway/.compat.generated.json && echo "---" && cat core/.compat.generated.json`
Expected: 内容如 spec §5.2 + §5.3 描述

- [ ] **Step 6: 跑三件套**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: 全 PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/sync-compat.mjs scripts/sync-compat.test.mjs
git commit -m "feat(compat): 新增 sync-compat 脚本（build-time 切出各端 slice）"
```

---

### Task 1.4：加 predev / prebuild 钩子 + .gitignore

**目的**：让 dev / build 跑前自动 sync；生成的 `.compat.generated.json` 不入版本。

**Files:**

- Modify: `client/package.json`
- Modify: `gateway/package.json`
- Modify: `core/package.json`
- Modify: `.gitignore`

- [ ] **Step 1: 给三个子项目加钩子**

每个子项目 `package.json` 的 `scripts` 块加：

`client/package.json`：

```json
"scripts": {
  // ... existing ...
  "predev":    "node ../scripts/sync-compat.mjs",
  "prebuild":  "node ../scripts/sync-compat.mjs"
}
```

`gateway/package.json`：

```json
"scripts": {
  // ... existing ...
  "predev":    "node ../scripts/sync-compat.mjs",
  "prebuild":  "node ../scripts/sync-compat.mjs"
}
```

`core/package.json`：

```json
"scripts": {
  // ... existing ...
  "predev":    "node ../scripts/sync-compat.mjs",
  "prebuild":  "node ../scripts/sync-compat.mjs"
}
```

- [ ] **Step 2: 更新 .gitignore**

在 `/home/handdeng/rd-center/my-ai/.gitignore` 末尾追加：

```
# v2 compat 同步生成的切片（每次 build 重写）
.compat.generated.json
client/src/compat.generated.ts
```

- [ ] **Step 3: 验证钩子触发**

Run: `cd client && pnpm run predev && cd ..`
Expected: 看到 sync 脚本的 `✓` 输出，文件实际生成

- [ ] **Step 4: 验证 git 已忽略**

Run: `git status --ignored | head -20`
Expected: `.compat.generated.json` 和 `client/src/compat.generated.ts` 出现在 ignored 列表

- [ ] **Step 5: 跑三件套**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: 全 PASS

- [ ] **Step 6: Commit**

```bash
git add client/package.json gateway/package.json core/package.json .gitignore
git commit -m "build: 加 predev/prebuild 同步钩子 + gitignore 生成文件"
```

---

### Task 1.5：根 package.json 加手动 sync:compat / check:compat 脚本

**目的**：手动调 sync / check，不依赖子项目 dev 钩子（CI 也可能用到）。

**Files:**

- Modify: `package.json` (root)

- [ ] **Step 1: 加脚本**

编辑 `/home/handdeng/rd-center/my-ai/package.json` 的 `scripts` 块，加：

```json
"scripts": {
  // ... existing ...
  "sync:compat":  "node scripts/sync-compat.mjs",
  "check:compat": "node scripts/check-compat-matrix.mjs versions/compat-matrix.json"
}
```

- [ ] **Step 2: 验证**

Run: `pnpm run sync:compat && pnpm run check:compat`
Expected: 两条命令都成功

- [ ] **Step 3: 跑三件套**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: 全 PASS

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "build: 根 package.json 加 sync:compat / check:compat 脚本"
```

---

## Phase 2：core 层（canonical 兼容模块）

### Task 2.1：写 `core/src/compat/check.ts`（TDD）

**目的**：canonical 版本的 `checkCompat` 函数。gateway / client 后序各复制一份。

**Files:**

- Create: `core/src/compat/check.test.ts`
- Create: `core/src/compat/check.ts`

- [ ] **Step 1: 写失败的测试**

新建 `/home/handdeng/rd-center/my-ai/core/src/compat/check.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { checkCompat } from './check.js';

describe('checkCompat', () => {
  it('version 在范围内 → true', () => {
    expect(checkCompat('2.0.0', '>=2.0.0 <3.0.0')).toBe(true);
  });

  it('version 低于范围 → false', () => {
    expect(checkCompat('1.5.0', '>=2.0.0 <3.0.0')).toBe(false);
  });

  it('version 高于范围上界（边界）→ false', () => {
    expect(checkCompat('3.0.0', '>=2.0.0 <3.0.0')).toBe(false);
  });

  it('version 在 pre-release 段但 base 在范围内 → true', () => {
    expect(checkCompat('2.0.0-rc.1', '>=2.0.0 <3.0.0')).toBe(true);
  });

  it('version 不是合法 semver → false（保守）', () => {
    expect(checkCompat('not-a-version', '>=2.0.0')).toBe(false);
  });

  it('range 不是合法 semver range → false（保守）', () => {
    expect(checkCompat('2.0.0', 'not-a-range')).toBe(false);
  });

  it('空字符串 → false', () => {
    expect(checkCompat('', '>=2.0.0')).toBe(false);
    expect(checkCompat('2.0.0', '')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试看是否失败**

Run: `pnpm --filter @my-ai/core exec vitest run src/compat/check.test.ts`
Expected: FAIL with "Cannot find module './check.js'"

- [ ] **Step 3: 实现**

新建 `/home/handdeng/rd-center/my-ai/core/src/compat/check.ts`：

```ts
// 与 gateway/src/compat/check.ts、client/src/compat/check.ts 保持一致。
// canonical 版本（测试覆盖最完整）。如修改请同步另外两份。
import semver from 'semver';

/**
 * 判断 got（上游版本）是否满足 want（下游声明的范围）。
 * 任一参数非法时返回 false（保守路径：无法确认即视为不兼容）。
 */
export function checkCompat(got: string, want: string): boolean {
  if (!semver.valid(got) || !semver.validRange(want)) return false;
  return semver.satisfies(got, want, { includePrerelease: true });
}
```

- [ ] **Step 4: 跑测试看是否通过**

Run: `pnpm --filter @my-ai/core exec vitest run src/compat/check.test.ts`
Expected: 7 个用例全 PASS

- [ ] **Step 5: 跑三件套**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: 全 PASS

- [ ] **Step 6: Commit**

```bash
git add core/src/compat/check.ts core/src/compat/check.test.ts
git commit -m "feat(core): 新增 checkCompat（version range matcher，canonical）"
```

---

### Task 2.2：写 `core/src/compat/load.ts`（TDD）

**目的**：从 `.compat.generated.json` 读出 compat slice；找不到时抛错（启动 fail-fast）。

**Files:**

- Create: `core/src/compat/load.test.ts`
- Create: `core/src/compat/load.ts`

- [ ] **Step 1: 写失败的测试**

新建 `/home/handdeng/rd-center/my-ai/core/src/compat/load.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCompat, type Compat } from './load.js';

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'load-compat-'));
  // 模拟 dist 目录结构：core/dist/index.js → 上两级是 core/
  // 我们的 loadCompat 用 import.meta.url 解析，测试时用 stub
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe('parseCompat', () => {
  it('合法 JSON → 解析为 Compat 对象', async () => {
    const { parseCompat } = await import('./load.js');
    const sample: Compat = { version: '2.0.0', upstream: { core: '>=2.0.0' } };
    const tmpFile = join(workdir, 'sample.json');
    writeFileSync(tmpFile, JSON.stringify(sample));
    expect(parseCompat(tmpFile)).toEqual(sample);
  });

  it('JSON 非法 → 抛错', async () => {
    const { parseCompat } = await import('./load.js');
    const tmpFile = join(workdir, 'bad.json');
    writeFileSync(tmpFile, '{not json');
    expect(() => parseCompat(tmpFile)).toThrow();
  });

  it('version 字段不是合法 semver → 抛错', async () => {
    const { parseCompat } = await import('./load.js');
    const tmpFile = join(workdir, 'bad-version.json');
    writeFileSync(tmpFile, JSON.stringify({ version: 'not-semver', upstream: {} }));
    expect(() => parseCompat(tmpFile)).toThrow(/semver/);
  });

  it('upstream 中某 range 不合法 → 抛错', async () => {
    const { parseCompat } = await import('./load.js');
    const tmpFile = join(workdir, 'bad-range.json');
    writeFileSync(tmpFile, JSON.stringify({ version: '2.0.0', upstream: { x: 'bad' } }));
    expect(() => parseCompat(tmpFile)).toThrow(/semver/);
  });
});
```

- [ ] **Step 2: 跑测试看是否失败**

Run: `pnpm --filter @my-ai/core exec vitest run src/compat/load.test.ts`
Expected: FAIL with "Cannot find module './load.js'"

- [ ] **Step 3: 实现**

新建 `/home/handdeng/rd-center/my-ai/core/src/compat/load.ts`：

```ts
// 从 .compat.generated.json 读取并校验 compat slice。
// 启动时由 server.ts 调用；找不到或格式错误时抛错（loud fail）。
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

export type Compat = {
  version: string;
  upstream: Record<string, string>;
};

/**
 * 解析单个 compat JSON 文件并校验：
 * - version 必须是合法 semver
 * - upstream 各项 range 必须是合法 semver range
 * 校验失败抛错（启动 fail-fast）。
 */
export function parseCompat(filePath: string): Compat {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new Error(
      `读取 ${filePath} 失败: ${(e as Error).message}（请先跑 prebuild 同步 compat）`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`解析 ${filePath} 失败: 不是合法 JSON`);
  }
  const compat = parsed as Partial<Compat>;
  if (!semver.valid(compat.version ?? '')) {
    throw new Error(`${filePath} 的 version "${compat.version}" 不是合法 semver`);
  }
  for (const [up, range] of Object.entries(compat.upstream ?? {})) {
    if (!semver.validRange(range)) {
      throw new Error(`${filePath} 的 upstream.${up} range "${range}" 不是合法 semver range`);
    }
  }
  return compat as Compat;
}

/**
 * 在当前进程的 dist/.. 路径下找 .compat.generated.json 并解析。
 * 文件名按惯例：{subprojectName}/.compat.generated.json
 * subprojectName 由调用方传入。
 */
export function loadCompat(subprojectName: string): Compat {
  // import.meta.url 指向当前文件。core/dist/compat/load.js → 上两级是 core/
  // 实际 .compat.generated.json 在 core/.compat.generated.json
  const here = dirname(fileURLToPath(import.meta.url));
  const target = resolve(here, '..', '..', `${subprojectName}.compat.generated.json`);
  return parseCompat(target);
}
```

- [ ] **Step 4: 跑测试看是否通过**

Run: `pnpm --filter @my-ai/core exec vitest run src/compat/load.test.ts`
Expected: 4 个用例全 PASS

- [ ] **Step 5: 跑三件套**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: 全 PASS

- [ ] **Step 6: Commit**

```bash
git add core/src/compat/load.ts core/src/compat/load.test.ts
git commit -m "feat(core): 新增 loadCompat（启动时读 + 校验 .compat.generated.json）"
```

---

### Task 2.3：core 启动时 load compat 并 fail-fast

**目的**：core 进程启动时调 `loadCompat('core')`；失败直接退出 1。

**Files:**

- Modify: `core/src/index.ts`
- Modify: `core/src/server.ts`（如需注入 compat 给路由）

- [ ] **Step 1: 修改 `core/src/index.ts`**

```ts
// 替换文件内容
import { loadConfig } from './config.js';
import { buildServer } from './server.js';
import { loadCompat } from './compat/load.js';

// 启动时同步加载 compat；失败直接退出
let compat;
try {
  compat = loadCompat('core');
  // eslint-disable-next-line no-console
  console.log(
    `✓ core compat loaded: version=${compat.version}, upstream=${JSON.stringify(compat.upstream)}`,
  );
} catch (e) {
  // eslint-disable-next-line no-console
  console.error(`✖ core 启动失败: ${(e as Error).message}`);
  process.exit(1);
}

const cfg = loadConfig();
const app = await buildServer(cfg, compat);

try {
  await app.listen({ host: cfg.HOST, port: cfg.PORT });
  app.log.info(`core listening on http://${cfg.HOST}:${cfg.PORT}`);
  app.log.info(`llm provider: ${cfg.LLM_PROVIDER} model: ${cfg.LLM_MODEL}`);
} catch (err) {
  app.log.error(err, 'failed to start core');
  process.exit(1);
}

const shutdown = async (signal: string) => {
  app.log.info(`received ${signal}, shutting down`);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
```

- [ ] **Step 2: 修改 `core/src/server.ts`，让 buildServer 接收 compat**

```ts
// 顶部 import 加
import type { Compat } from './compat/load.js';

// 修改函数签名
export async function buildServer(cfg: Config, compat: Compat) {
  // ... 现有代码 ...
  // 把 compat 挂到 app decorate（路由里访问用）
  app.decorate('compat', compat);
  // ... 现有 routes 注册 ...
}
```

需要 import 装饰类型。在文件顶部加：

```ts
// Fastify 类型扩展
declare module 'fastify' {
  interface FastifyInstance {
    compat: Compat;
  }
}
```

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @my-ai/core run typecheck`
Expected: PASS（如果 routes/health.ts 没用 compat，可正常）

- [ ] **Step 4: 跑三件套**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add core/src/index.ts core/src/server.ts
git commit -m "feat(core): 启动时 load compat，失败退出"
```

---

### Task 2.4：扩展 core `/health` 响应（TDD）

**目的**：`/health` 返回 `{ok, service, version, schema}`，给 client 拿来 handshake。

**Files:**

- Modify: `core/src/routes/health.ts`
- Modify: `core/src/routes/health.test.ts`

- [ ] **Step 1: 扩展测试**

修改 `/home/handdeng/rd-center/my-ai/core/src/routes/health.test.ts`，在现有用例后追加：

```ts
describe('/health version 字段', () => {
  it('响应含 version 和 schema', async () => {
    const app = await buildServer(loadConfig(), {
      version: '2.0.0',
      upstream: {},
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      ok: true,
      service: 'core',
      version: '2.0.0',
      schema: 1,
    });
  });
});
```

- [ ] **Step 2: 跑测试看是否失败**

Run: `pnpm --filter @my-ai/core exec vitest run src/routes/health.test.ts`
Expected: FAIL（version / schema 字段缺失）

- [ ] **Step 3: 改 `core/src/routes/health.ts`**

```ts
// 替换文件内容
import type { FastifyInstance } from 'fastify';
import type { Compat } from '../compat/load.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({
    ok: true,
    service: 'core',
    version: app.compat.version,
    schema: 1,
  }));
}
```

- [ ] **Step 4: 跑测试看是否通过**

Run: `pnpm --filter @my-ai/core exec vitest run src/routes/health.test.ts`
Expected: 全 PASS

- [ ] **Step 5: 跑三件套**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: 全 PASS

- [ ] **Step 6: Commit**

```bash
git add core/src/routes/health.ts core/src/routes/health.test.ts
git commit -m "feat(core): /health 扩展 version + schema 字段"
```

---

## Phase 3：gateway 层（镜像 core）

### Task 3.1：gateway 镜像 check + load

**目的**：gateway 端持有等价 check / load 实现（避免 monorepo 共享包）。

**Files:**

- Create: `gateway/src/compat/check.ts`
- Create: `gateway/src/compat/check.test.ts`
- Create: `gateway/src/compat/load.ts`
- Create: `gateway/src/compat/load.test.ts`

- [ ] **Step 1: 复制 check.ts 和 check.test.ts**

`cp core/src/compat/check.ts gateway/src/compat/check.ts`
`cp core/src/compat/check.test.ts gateway/src/compat/check.test.ts`

在 `gateway/src/compat/check.ts` 顶部把 "canonical" 注释改成 "镜像自 core/src/compat/check.ts"：

```ts
// 镜像自 core/src/compat/check.ts，保持一致。
// canonical 版本在 core；修改请同步。
import semver from 'semver';

export function checkCompat(got: string, want: string): boolean {
  if (!semver.valid(got) || !semver.validRange(want)) return false;
  return semver.satisfies(got, want, { includePrerelease: true });
}
```

`check.test.ts` 不动（同一份测试）。

- [ ] **Step 2: 复制 load.ts 和 load.test.ts**

`cp core/src/compat/load.ts gateway/src/compat/load.ts`
`cp core/src/compat/load.test.ts gateway/src/compat/load.test.ts`

`load.ts` 不动（load 路径解析对本端无差异）。

- [ ] **Step 3: 跑测试**

Run: `pnpm --filter @my-ai/gateway exec vitest run src/compat/`
Expected: 11 个用例全 PASS（7 check + 4 load）

- [ ] **Step 4: 跑三件套**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/compat/
git commit -m "feat(gateway): 镜像 core 的 compat 模块（check + load）"
```

---

### Task 3.2：gateway 启动时 load + 扩展 /health

**目的**：gateway 启动 fail-fast + `/health` 返回 version + schema。

**Files:**

- Modify: `gateway/src/index.ts`
- Modify: `gateway/src/server.ts`
- Modify: `gateway/src/routes/health.ts`
- Create: `gateway/src/routes/health.test.ts`

- [ ] **Step 1: 改 `gateway/src/index.ts`**（同 core 模式）

```ts
import { loadConfig } from './config.js';
import { buildServer } from './server.js';
import { loadCompat } from './compat/load.js';

let compat;
try {
  compat = loadCompat('gateway');
  // eslint-disable-next-line no-console
  console.log(
    `✓ gateway compat loaded: version=${compat.version}, upstream=${JSON.stringify(compat.upstream)}`,
  );
} catch (e) {
  // eslint-disable-next-line no-console
  console.error(`✖ gateway 启动失败: ${(e as Error).message}`);
  process.exit(1);
}

const cfg = loadConfig();
const app = await buildServer(cfg, compat);

try {
  await app.listen({ host: cfg.HOST, port: cfg.PORT });
  app.log.info(`gateway listening on http://${cfg.HOST}:${cfg.PORT}`);
} catch (err) {
  app.log.error(err, 'failed to start gateway');
  process.exit(1);
}

const shutdown = async (signal: string) => {
  app.log.info(`received ${signal}, shutting down`);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
```

- [ ] **Step 2: 改 `gateway/src/server.ts`**

同 core：在 `buildServer` 加 compat 参数 + `app.decorate('compat', compat)` + FastifyInstance 类型扩展。

- [ ] **Step 3: 替换 `gateway/src/routes/health.ts`**

```ts
import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({
    ok: true,
    service: 'gateway',
    version: app.compat.version,
    schema: 1,
  }));
}
```

- [ ] **Step 4: 加测试 `gateway/src/routes/health.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';

describe('GET /health', () => {
  it('返回 ok, service, version, schema', async () => {
    const app = await buildServer(loadConfig(), {
      version: '2.0.0',
      upstream: { core: '>=2.0.0 <3.0.0' },
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      service: 'gateway',
      version: '2.0.0',
      schema: 1,
    });
  });
});
```

- [ ] **Step 5: 跑 gateway 测试**

Run: `pnpm --filter @my-ai/gateway exec vitest run`
Expected: 全 PASS

- [ ] **Step 6: 跑三件套**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: 全 PASS

- [ ] **Step 7: Commit**

```bash
git add gateway/src/index.ts gateway/src/server.ts gateway/src/routes/health.ts gateway/src/routes/health.test.ts
git commit -m "feat(gateway): 启动 fail-fast + /health 扩展 version+schema"
```

---

## Phase 4：client 层

### Task 4.1：client 镜像 check

**目的**：client 持有等价 check 实现（v2 客户端不向 gateway 暴露 compat range；只用来本地 handshake 判断）。

**Files:**

- Create: `client/src/compat/check.ts`
- Create: `client/src/compat/check.test.ts`

- [ ] **Step 1: 复制**

`cp core/src/compat/check.ts client/src/compat/check.ts`
`cp core/src/compat/check.test.ts client/src/compat/check.test.ts`

`check.ts` 顶部注释改为 "镜像自 core/src/compat/check.ts"。

- [ ] **Step 2: 跑测试**

Run: `pnpm --filter @my-ai/client exec vitest run src/compat/`
Expected: 7 个用例全 PASS

- [ ] **Step 3: 跑三件套**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: 全 PASS

- [ ] **Step 4: Commit**

```bash
git add client/src/compat/
git commit -m "feat(client): 镜像 core 的 checkCompat"
```

---

### Task 4.2：写 `client/src/compat/handshake.ts`（TDD）

**目的**：client 端握手逻辑：调 /health，解析 version，对照本地 compat range，返回 status。

**Files:**

- Create: `client/src/compat/handshake.ts`
- Create: `client/src/compat/handshake.test.ts`

- [ ] **Step 1: 写失败的测试**

新建 `/home/handdeng/rd-center/my-ai/client/src/compat/handshake.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handshake, type HandshakeStatus } from './handshake.js';
import { COMPAT } from './compat.generated.js';

const GATEWAY_URL = 'http://gateway.test';

describe('handshake', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetch 成功且 version 在范围内 → HEALTHY', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: true, service: 'gateway', version: '2.0.0', schema: 1 }),
            { status: 200 },
          ),
      ),
    );
    const result = await handshake(GATEWAY_URL, COMPAT);
    expect(result.status).toBe<HandshakeStatus>('HEALTHY');
    expect(result.version).toBe('2.0.0');
  });

  it('fetch 成功但 version 不在范围内 → MISMATCH', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: true, service: 'gateway', version: '1.0.0', schema: 1 }),
            { status: 200 },
          ),
      ),
    );
    const result = await handshake(GATEWAY_URL, COMPAT);
    expect(result.status).toBe<HandshakeStatus>('MISMATCH');
    expect(result.version).toBe('1.0.0');
  });

  it('schema 字段缺失 → MISMATCH（保守）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, service: 'gateway', version: '2.0.0' }), {
            status: 200,
          }),
      ),
    );
    const result = await handshake(GATEWAY_URL, COMPAT);
    expect(result.status).toBe<HandshakeStatus>('MISMATCH');
  });

  it('schema 字段非 1 → MISMATCH', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: true, service: 'gateway', version: '2.0.0', schema: 2 }),
            { status: 200 },
          ),
      ),
    );
    const result = await handshake(GATEWAY_URL, COMPAT);
    expect(result.status).toBe<HandshakeStatus>('MISMATCH');
  });

  it('fetch throw → PAIR_FAILED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      }),
    );
    const result = await handshake(GATEWAY_URL, COMPAT);
    expect(result.status).toBe<HandshakeStatus>('PAIR_FAILED');
  });

  it('HTTP 5xx → PAIR_FAILED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('server error', { status: 503 })),
    );
    const result = await handshake(GATEWAY_URL, COMPAT);
    expect(result.status).toBe<HandshakeStatus>('PAIR_FAILED');
  });
});
```

- [ ] **Step 2: 跑测试看是否失败**

Run: `pnpm --filter @my-ai/client exec vitest run src/compat/handshake.test.ts`
Expected: FAIL with "Cannot find module './handshake.js'"

- [ ] **Step 3: 实现**

新建 `/home/handdeng/rd-center/my-ai/client/src/compat/handshake.ts`：

```ts
// client 端握手：调 gateway /health，解析 version，对照 compat range。
import { checkCompat } from './check.js';
import type { Compat } from './compat.generated.js';

export type HandshakeStatus = 'PAIRING' | 'HEALTHY' | 'MISMATCH' | 'PAIR_FAILED';

export type HandshakeResult = {
  status: HandshakeStatus;
  version: string | null;
};

/**
 * 发起一次握手。返回结果包含状态和拿到的 version（用于 UI 展示）。
 * 不抛错：所有错误转为 PAIR_FAILED。
 */
export async function handshake(gatewayUrl: string, compat: Compat): Promise<HandshakeResult> {
  let res: Response;
  try {
    res = await fetch(`${gatewayUrl}/health`);
  } catch {
    return { status: 'PAIR_FAILED', version: null };
  }
  if (!res.ok) {
    return { status: 'PAIR_FAILED', version: null };
  }
  let body: { ok?: boolean; service?: string; version?: string; schema?: number };
  try {
    body = await res.json();
  } catch {
    return { status: 'MISMATCH', version: null };
  }
  if (body.schema !== 1 || typeof body.version !== 'string') {
    return { status: 'MISMATCH', version: body.version ?? null };
  }
  const want = compat.upstream.gateway;
  if (!want) {
    // compat 里没声明 gateway 范围：保守视为不兼容
    return { status: 'MISMATCH', version: body.version };
  }
  const inRange = checkCompat(body.version, want);
  return {
    status: inRange ? 'HEALTHY' : 'MISMATCH',
    version: body.version,
  };
}
```

- [ ] **Step 4: 跑测试看是否通过**

Run: `pnpm --filter @my-ai/client exec vitest run src/compat/handshake.test.ts`
Expected: 6 个用例全 PASS

- [ ] **Step 5: 跑三件套**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: 全 PASS

- [ ] **Step 6: Commit**

```bash
git add client/src/compat/handshake.ts client/src/compat/handshake.test.ts
git commit -m "feat(client): 新增 handshake（fetch /health + version 校验）"
```

---

### Task 4.3：写 `MismatchBanner` 组件（TDD）

**目的**：mismatch 提示横幅，session 内 sticky dismiss，进程重启重置。

**Files:**

- Create: `client/src/components/MismatchBanner.tsx`
- Create: `client/src/components/MismatchBanner.test.tsx`

- [ ] **Step 1: 写失败的测试**

新建 `/home/handdeng/rd-center/my-ai/client/src/components/MismatchBanner.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MismatchBanner } from './MismatchBanner.js';

describe('MismatchBanner', () => {
  it('渲染完整提示文案', () => {
    render(
      <MismatchBanner gatewayVersion="1.5.0" requiredRange=">=2.0.0 <3.0.0" onDismiss={vi.fn()} />,
    );
    expect(screen.getByText(/1\.5\.0/)).toBeInTheDocument();
    expect(screen.getByText(/>=2\.0\.0 <3\.0\.0/)).toBeInTheDocument();
  });

  it('点关闭按钮调用 onDismiss', () => {
    const onDismiss = vi.fn();
    render(
      <MismatchBanner
        gatewayVersion="1.5.0"
        requiredRange=">=2.0.0 <3.0.0"
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /关闭/ }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('version 为 null 时不显示具体版本号', () => {
    render(
      <MismatchBanner gatewayVersion={null} requiredRange=">=2.0.0 <3.0.0" onDismiss={vi.fn()} />,
    );
    // 不应该有 "vnull" 这种文案
    expect(screen.queryByText(/null/)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试看是否失败**

Run: `pnpm --filter @my-ai/client exec vitest run src/components/MismatchBanner.test.tsx`
Expected: FAIL with module not found

- [ ] **Step 3: 实现**

新建 `/home/handdeng/rd-center/my-ai/client/src/components/MismatchBanner.tsx`：

```tsx
// Mismatch 警告横幅。
// 关闭由父组件的 bannerDismissed state 控制；本组件只负责渲染 + 触发 onDismiss。
type Props = {
  gatewayVersion: string | null;
  requiredRange: string;
  onDismiss: () => void;
};

export function MismatchBanner({ gatewayVersion, requiredRange, onDismiss }: Props) {
  return (
    <div role="alert" className="mismatch-banner">
      <span>
        ⚠️ Gateway
        {gatewayVersion ? ` v${gatewayVersion}` : ''} 超出 client 兼容范围 ({requiredRange})。
        部分功能可能不可用，建议升级 gateway。
      </span>
      <button type="button" onClick={onDismiss}>
        关闭
      </button>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试看是否通过**

Run: `pnpm --filter @my-ai/client exec vitest run src/components/MismatchBanner.test.tsx`
Expected: 3 个用例全 PASS

- [ ] **Step 5: 跑三件套**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: 全 PASS

- [ ] **Step 6: Commit**

```bash
git add client/src/components/MismatchBanner.tsx client/src/components/MismatchBanner.test.tsx
git commit -m "feat(client): MismatchBanner 组件（session sticky dismiss）"
```

---

### Task 4.4：写 `Settings` 面板组件（TDD）

**目的**：用户输入 gateway URL + 看状态指示器 + 触发 test 重试。

**Files:**

- Create: `client/src/components/Settings.tsx`
- Create: `client/src/components/Settings.test.tsx`

- [ ] **Step 1: 写失败的测试**

新建 `/home/handdeng/rd-center/my-ai/client/src/components/Settings.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Settings } from './Settings.js';
import type { HandshakeStatus } from '../compat/handshake.js';

describe('Settings', () => {
  const baseProps = {
    url: 'http://gateway.test',
    onUrlChange: vi.fn(),
    onTest: vi.fn(),
    status: 'PAIRING' as HandshakeStatus,
    version: null,
  };

  it('渲染输入框、按钮、状态指示器', () => {
    render(<Settings {...baseProps} />);
    expect(screen.getByRole('textbox')).toHaveValue('http://gateway.test');
    expect(screen.getByRole('button', { name: /测试/ })).toBeInTheDocument();
  });

  it('改输入框触发 onUrlChange', () => {
    const onUrlChange = vi.fn();
    render(<Settings {...baseProps} onUrlChange={onUrlChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'http://new' } });
    expect(onUrlChange).toHaveBeenCalledWith('http://new');
  });

  it('点测试按钮触发 onTest', () => {
    const onTest = vi.fn();
    render(<Settings {...baseProps} onTest={onTest} />);
    fireEvent.click(screen.getByRole('button', { name: /测试/ }));
    expect(onTest).toHaveBeenCalledTimes(1);
  });

  it('HEALTHY 状态显示 "配对成功"', () => {
    render(<Settings {...baseProps} status="HEALTHY" version="2.0.0" />);
    expect(screen.getByText(/配对成功/)).toBeInTheDocument();
    expect(screen.getByText(/v2\.0\.0/)).toBeInTheDocument();
  });

  it('MISMATCH 状态显示 "版本不匹配"', () => {
    render(<Settings {...baseProps} status="MISMATCH" version="1.5.0" />);
    expect(screen.getByText(/版本不匹配/)).toBeInTheDocument();
    expect(screen.getByText(/v1\.5\.0/)).toBeInTheDocument();
  });

  it('PAIR_FAILED 状态显示 "连接失败"', () => {
    render(<Settings {...baseProps} status="PAIR_FAILED" />);
    expect(screen.getByText(/连接失败/)).toBeInTheDocument();
  });

  it('PAIRING 状态显示 "正在测试"', () => {
    render(<Settings {...baseProps} status="PAIRING" />);
    expect(screen.getByText(/正在测试/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试看是否失败**

Run: `pnpm --filter @my-ai/client exec vitest run src/components/Settings.test.tsx`
Expected: FAIL with module not found

- [ ] **Step 3: 实现**

新建 `/home/handdeng/rd-center/my-ai/client/src/components/Settings.tsx`：

```tsx
// Gateway 配对面板：URL 输入 + 测试按钮 + 状态指示器。
import type { HandshakeStatus } from '../compat/handshake.js';

type Props = {
  url: string;
  onUrlChange: (next: string) => void;
  onTest: () => void;
  status: HandshakeStatus;
  version: string | null;
};

const STATUS_LABEL: Record<HandshakeStatus, string> = {
  PAIRING: '正在测试…',
  HEALTHY: '配对成功',
  MISMATCH: '版本不匹配',
  PAIR_FAILED: '连接失败',
};

export function Settings({ url, onUrlChange, onTest, status, version }: Props) {
  return (
    <section>
      <h3>Gateway</h3>
      <input
        type="text"
        value={url}
        onChange={e => onUrlChange(e.target.value)}
        placeholder="http://gateway-host:8787"
        aria-label="Gateway URL"
      />
      <button type="button" onClick={onTest}>
        测试
      </button>
      <p>
        {STATUS_LABEL[status]}
        {status === 'HEALTHY' || status === 'MISMATCH'
          ? version
            ? ` · gateway v${version}`
            : ''
          : ''}
      </p>
    </section>
  );
}
```

- [ ] **Step 4: 跑测试看是否通过**

Run: `pnpm --filter @my-ai/client exec vitest run src/components/Settings.test.tsx`
Expected: 7 个用例全 PASS

- [ ] **Step 5: 跑三件套**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: 全 PASS

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Settings.tsx client/src/components/Settings.test.tsx
git commit -m "feat(client): Settings 面板（URL 输入 + 状态指示 + 测试）"
```

---

### Task 4.5：App 集成状态机 + heartbeat（TDD）

**目的**：在 App.tsx 里把 handshake、状态机、heartbeat、Banner、Settings 全部串起来。

**Files:**

- Modify: `client/src/App.tsx`
- Create: `client/src/App.test.tsx`

- [ ] **Step 1: 写失败的测试**

新建 `/home/handdeng/rd-center/my-ai/client/src/App.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import App from './App.js';

const GATEWAY_URL = 'http://gateway.test';

describe('App 状态机', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 注入默认 fetch mock：成功 + version 在范围内
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: true, service: 'gateway', version: '2.0.0', schema: 1 }),
            { status: 200 },
          ),
      ),
    );
    // 注入 import.meta.env
    vi.stubEnv('VITE_GATEWAY_URL', GATEWAY_URL);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('初始 render → Settings 可见', () => {
    render(<App />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('fetch 成功 + version in range → HEALTHY 状态', async () => {
    render(<App />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(await screen.findByText(/配对成功/)).toBeInTheDocument();
  });

  it('fetch 成功 + version out of range → MISMATCH + banner 显示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: true, service: 'gateway', version: '1.0.0', schema: 1 }),
            { status: 200 },
          ),
      ),
    );
    render(<App />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(await screen.findByText(/版本不匹配/)).toBeInTheDocument();
    expect(screen.getByText(/Gateway v1\.0\.0 超出/)).toBeInTheDocument();
  });

  it('点 banner 关闭按钮 → banner 消失，session 内不重亮', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: true, service: 'gateway', version: '1.0.0', schema: 1 }),
            { status: 200 },
          ),
      ),
    );
    render(<App />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    fireEvent.click(screen.getByRole('button', { name: /关闭/ }));
    expect(screen.queryByText(/Gateway v1\.0\.0 超出/)).toBeNull();

    // 推进 5 min fake timer + 触发 heartbeat
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });
    // banner 仍不显示
    expect(screen.queryByText(/Gateway v1\.0\.0 超出/)).toBeNull();
  });

  it('fetch throw → PAIR_FAILED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('net');
      }),
    );
    render(<App />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(await screen.findByText(/连接失败/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试看是否失败**

Run: `pnpm --filter @my-ai/client exec vitest run src/App.test.tsx`
Expected: FAIL

- [ ] **Step 3: 重写 `client/src/App.tsx`**

```tsx
// 客户端根组件：状态机 + heartbeat + 配对面板 + Mismatch banner。
// 状态机：PAIRING → HEALTHY / MISMATCH / PAIR_FAILED。
// 5 min heartbeat 重检；banner 关闭 session 内 sticky。
import { useEffect, useState } from 'react';
import { handshake, type HandshakeStatus } from './compat/handshake.js';
import { COMPAT } from './compat.generated.js';
import { Settings } from './components/Settings.js';
import { MismatchBanner } from './components/MismatchBanner.js';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://127.0.0.1:8787';
// 测试时可通过 import.meta.env 覆盖；缺省 5 min
const HEARTBEAT_MS = Number(import.meta.env.VITE_HEARTBEAT_INTERVAL_MS ?? 5 * 60 * 1000);

function App() {
  const [status, setStatus] = useState<HandshakeStatus>('PAIRING');
  const [version, setVersion] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // 启动 + heartbeat
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      // heartbeat 失败时**不**把 HEALTHY 变 PAIR_FAILED（避免抖动）
      const prev = status;
      const next = await handshake(GATEWAY_URL, COMPAT);
      if (cancelled) return;
      if (next.status === 'PAIR_FAILED' && (prev === 'HEALTHY' || prev === 'MISMATCH')) {
        return; // 静默保留
      }
      setStatus(next.status);
      if (next.version) setVersion(next.version);
    };
    void run();
    const id = setInterval(run, HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTest = async () => {
    setStatus('PAIRING');
    const next = await handshake(GATEWAY_URL, COMPAT);
    setStatus(next.status);
    if (next.version) setVersion(next.version);
    // 不重置 bannerDismissed：用户已"知晓 mismatch"的意图不应被 retry 重置
  };

  return (
    <main className="app">
      <h1>my-ai client</h1>
      <Settings
        url={GATEWAY_URL}
        onUrlChange={() => {
          /* URL 暂不持久化，v3+ 接入 tauri-plugin-store */
        }}
        onTest={handleTest}
        status={status}
        version={version}
      />
      {status === 'MISMATCH' && !bannerDismissed && (
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

- [ ] **Step 4: 跑测试看是否通过**

Run: `pnpm --filter @my-ai/client exec vitest run src/App.test.tsx`
Expected: 5 个用例全 PASS

- [ ] **Step 5: 跑三件套**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: 全 PASS

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx client/src/App.test.tsx
git commit -m "feat(client): App 集成状态机 + heartbeat + Banner"
```

---

### Task 4.6：client 升到 v2.0.0

**目的**：把 client 的 `package.json` 和 `tauri.conf.json` version 改成 2.0.0（与 matrix 一致）。

**Files:**

- Modify: `client/package.json`
- Modify: `client/src-tauri/tauri.conf.json`

- [ ] **Step 1: 改 `client/package.json`**

```jsonc
{
  "name": "@my-ai/client",
  "version": "2.0.0", // ← 从 "0.0.0" 改为 "2.0.0"
  // ... 其余不变 ...
}
```

- [ ] **Step 2: 改 `client/src-tauri/tauri.conf.json`**

在文件顶层加 `version` 字段（如果还没有）：

```jsonc
{
  "version": "2.0.0",
  // ... 其余不变 ...
}
```

- [ ] **Step 3: 验证两处一致**

Run: `node -e "const p=require('./client/package.json'); const t=require('./client/src-tauri/tauri.conf.json'); if(p.version!==t.version){console.error('mismatch'); process.exit(1)}; console.log('✓', p.version)"`
Expected: `✓ 2.0.0`

- [ ] **Step 4: 跑三件套**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add client/package.json client/src-tauri/tauri.conf.json
git commit -m "feat(client): version 0.0.0 → 2.0.0（v2 首发）"
```

---

## Phase 5：CI 校验 job

### Task 5.1：创建 `compat-matrix-check.yml`

**目的**：CI 跑 compat-matrix schema 校验，独立 job，PR 触发。

**Files:**

- Create: `.github/workflows/compat-matrix-check.yml`

- [ ] **Step 1: 创建 workflow**

新建 `/home/handdeng/rd-center/my-ai/.github/workflows/compat-matrix-check.yml`：

```yaml
name: compat-matrix check

on:
  pull_request:
    types: [opened, synchronize, reopened]
    branches: [main]
  push:
    branches: [main]

jobs:
  check:
    name: schema 1 校验
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0

      - name: Setup pnpm
        uses: pnpm/action-setup@v6

      - name: Setup Node
        uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm

      - name: Install
        run: pnpm install --frozen-lockfile

      - name: Run check
        run: pnpm run check:compat
```

- [ ] **Step 2: 本地冒烟**

Run: `pnpm run check:compat`
Expected: exit 0，输出 `✓ versions/compat-matrix.json 通过 schema 1 校验`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/compat-matrix-check.yml
git commit -m "ci: 新增 compat-matrix check workflow"
```

---

### Task 5.2：创建 `version-bump-check.yml`

**目的**：CI 检查 PR 是否在改子项目代码时同步 bump version。

**Files:**

- Create: `.github/scripts/version-bump-check.sh`
- Create: `.github/workflows/version-bump-check.yml`

- [ ] **Step 1: 创建检查脚本**

新建 `/home/handdeng/rd-center/my-ai/.github/scripts/version-bump-check.sh`：

```bash
#!/usr/bin/env bash
# 校验 PR 是否在改子项目代码时同步 bump version。
# 失败时非零退出并打印哪一端不满足。
set -uo pipefail

BASE="${1:-origin/main}"
HEAD="${2:-HEAD}"

if ! git rev-parse "$BASE" >/dev/null 2>&1; then
  echo "✖ base $BASE 不存在"; exit 1
fi

changed=$(git diff --name-only "$BASE"..."$HEAD" 2>/dev/null || git diff --name-only "$HEAD")
fail() { echo "✖ $1"; exit 1; }

# client：src/ 或 src-tauri/ 下代码改了 → package.json + tauri.conf.json 都要改
client_code=$(echo "$changed" | grep -E '^client/(src|src-tauri/.*\.(rs|toml))$' || true)
client_pkg=$(echo "$changed" | grep -E '^client/package\.json$' || true)
client_tauri=$(echo "$changed" | grep -E '^client/src-tauri/tauri\.conf\.json$' || true)
if [ -n "$client_code" ] && { [ -z "$client_pkg" ] || [ -z "$client_tauri" ]; }; then
  fail "client 代码有变更但未同步 bump client/package.json 和 client/src-tauri/tauri.conf.json"
fi

# gateway / core：src/ 改了 → package.json 必须改
for sub in gateway core; do
  code=$(echo "$changed" | grep -E "^$sub/src/" || true)
  pkg=$(echo "$changed" | grep -E "^$sub/package\.json$" || true)
  if [ -n "$code" ] && [ -z "$pkg" ]; then
    fail "$sub 代码有变更但未 bump $sub/package.json"
  fi
done

echo "✓ version bump 检查通过"
```

- [ ] **Step 2: 给脚本加可执行权限**

Run: `chmod +x .github/scripts/version-bump-check.sh`

- [ ] **Step 3: 本地冒烟**

Run: `bash .github/scripts/version-bump-check.sh HEAD~1 HEAD`（用一个旧 commit 测）
Expected: 输出 `✓ version bump 检查通过` 或对应 fail（取决于 diff 内容）

- [ ] **Step 4: 创建 workflow**

新建 `/home/handdeng/rd-center/my-ai/.github/workflows/version-bump-check.yml`：

```yaml
name: version-bump check

on:
  pull_request:
    types: [opened, synchronize, reopened]
    branches: [main]

jobs:
  check:
    name: 子项目代码变更必须 bump version
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0

      - name: Run check
        run: bash .github/scripts/version-bump-check.sh origin/main HEAD
```

- [ ] **Step 5: 跑三件套**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: 全 PASS（CI 脚本不在 pnpm scope）

- [ ] **Step 6: Commit**

```bash
git add .github/scripts/version-bump-check.sh .github/workflows/version-bump-check.yml
git commit -m "ci: 新增 version-bump check workflow"
```

---

### Task 5.3：创建 `release.yml`

**目的**：PR 合入 main 后自动判断是否出 GitHub Release；含 body 渲染。

**Files:**

- Create: `.github/scripts/render-release-notes.sh`
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: 创建 release body 渲染脚本**

新建 `/home/handdeng/rd-center/my-ai/.github/scripts/render-release-notes.sh`：

```bash
#!/usr/bin/env bash
# 从 versions/compat-matrix.json + 上次 release 以来 diff 渲染 release body。
# 输出 markdown 到 stdout。调用方负责重定向到文件。
set -uo pipefail

MATRIX="versions/compat-matrix.json"
LAST_TAG="${1:-}"

if [ ! -f "$MATRIX" ]; then
  echo "✖ 缺 $MATRIX"; exit 1
fi

# 解析 matrix 字段（用 node，避免 jq 依赖）
read_version() {
  node -e "const m=require('./$MATRIX'); console.log(m.components['$1'].version)"
}
read_range() {
  node -e "const m=require('./$MATRIX'); console.log((m.compat['$1']||{})['$2']||'-')"
}

CLIENT_VER=$(read_version client)
GW_VER=$(read_version gateway)
CORE_VER=$(read_version core)
CLIENT_GW_RANGE=$(read_range client gateway)
GW_CORE_RANGE=$(read_range gateway core)

DATE=$(date +%Y-%m-%d)
SHORT_SHA="${GITHUB_SHA:-$(git rev-parse --short HEAD)}"

cat <<EOF
## my-ai release-${DATE//-/}-${SHORT_SHA} (${DATE})

### 子项目版本
- client  : ${CLIENT_VER}
- gateway : ${GW_VER}
- core    : ${CORE_VER}

### 兼容矩阵
| 下游    | 上游    | 接受范围        |
| ------- | ------- | --------------- |
| client  | gateway | ${CLIENT_GW_RANGE} |
| gateway | core    | ${GW_CORE_RANGE}    |
| core    | —       | —              |

EOF

# 如果是首次 release（无 last tag），跳过 diff 段
if [ -z "$LAST_TAG" ]; then
  cat <<EOF
### 功能变更
- **client**: （无）
- **gateway**: （无）
- **core**: （无）

### Bug 修复
- **client**: （无）
- **gateway**: （无）
- **core**: （无）

### 兼容性变更
- （首次 release，无 diff 来源）
EOF
  exit 0
fi

# 拿到 last 以来所有 commits，提取 feat:/fix: 开头的
COMMITS=$(git log "$LAST_TAG"..HEAD --pretty=format:"%H %s" 2>/dev/null || true)

echo "### 功能变更"
for sub in client gateway core; do
  echo "- **$sub**:"
  feats=$(echo "$COMMITS" | while read -r hash subject; do
    [ -z "$subject" ] && continue
    # 简单解析：type: subject 形式
    type="${subject%%:*}"
    rest="${subject#*: }"
    if [ "$type" = "feat" ]; then
      # 看 commit 改了哪些 $sub 路径
      if git diff-tree --no-commit-id --name-only -r "$hash" 2>/dev/null | grep -q "^$sub/"; then
        echo "  - feat: $rest"
      fi
    fi
  done)
  if [ -z "$feats" ]; then
    echo "  - （无）"
  else
    echo "$feats"
  fi
done

echo ""
echo "### Bug 修复"
for sub in client gateway core; do
  echo "- **$sub**:"
  fixes=$(echo "$COMMITS" | while read -r hash subject; do
    [ -z "$subject" ] && continue
    type="${subject%%:*}"
    rest="${subject#*: }"
    if [ "$type" = "fix" ]; then
      if git diff-tree --no-commit-id --name-only -r "$hash" 2>/dev/null | grep -q "^$sub/"; then
        echo "  - fix: $rest"
      fi
    fi
  done)
  if [ -z "$fixes" ]; then
    echo "  - （无）"
  else
    echo "$fixes"
  fi
done

echo ""
echo "### 兼容性变更"
compat_changed=$(git log "$LAST_TAG"..HEAD --pretty=format:"" -- versions/compat-matrix.json | wc -l)
if [ "$compat_changed" -gt 0 ]; then
  echo "- versions/compat-matrix.json 在此次 release 中有变更（详见 git diff）"
else
  echo "- （无）"
fi
```

- [ ] **Step 2: 给脚本可执行权限**

Run: `chmod +x .github/scripts/render-release-notes.sh`

- [ ] **Step 3: 创建 workflow**

新建 `/home/handdeng/rd-center/my-ai/.github/workflows/release.yml`：

```yaml
name: GitHub Release

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: write

jobs:
  release:
    name: 自动出 release（条件触发）
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v5
        with:
          node-version: 24

      - name: 读上次 release tag
        id: last
        run: |
          last=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
          echo "last=$last" >> "$GITHUB_OUTPUT"
          echo "last_tag=$last" >> "$GITHUB_ENV"

      - name: 判断是否需要 release
        id: decide
        run: |
          if [ -z "${{ steps.last.outputs.last }}" ]; then
            echo "need_release=true" >> "$GITHUB_OUTPUT"
            echo "首次 release：强制出 baseline" >&2
            exit 0
          fi
          changed=$(git diff --name-only "${{ steps.last.outputs.last }}"..HEAD)
          echo "$changed" >&2
          if echo "$changed" | grep -q '^versions/compat-matrix\.json$'; then
            echo "matrix 变化 → 出 release"; echo "need_release=true" >> "$GITHUB_OUTPUT"
          elif echo "$changed" | grep -qE '^(client/package\.json|client/src-tauri/tauri\.conf\.json|gateway/package\.json|core/package\.json)$'; then
            echo "version bump → 出 release"; echo "need_release=true" >> "$GITHUB_OUTPUT"
          else
            echo "need_release=false" >> "$GITHUB_OUTPUT"
            echo "无 version / matrix 变化 → 不出 release"
          fi

      - name: 渲染 body + 创建 release
        if: steps.decide.outputs.need_release == 'true'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set -e
          DATE=$(date +%Y%m%d)
          SHORT_SHA=$(git rev-parse --short HEAD)
          TAG="release-${DATE}-${SHORT_SHA}"
          BODY=$(bash .github/scripts/render-release-notes.sh "${{ steps.last.outputs.last }}")
          echo "$BODY" > /tmp/release-body.md
          gh release create "$TAG" \
            --title "my-ai ${TAG}" \
            --notes-file /tmp/release-body.md \
            --target main
          echo "✓ release ${TAG} 已创建"
```

- [ ] **Step 4: 跑三件套**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add .github/scripts/render-release-notes.sh .github/workflows/release.yml
git commit -m "ci: 新增 release workflow（自动判断 + body 渲染）"
```

---

## Phase 6：Release 工具 + 首发

### Task 6.1：本地冒烟 release 脚本

**目的**：在仓库里把 release body 渲染脚本的输出核对一遍，确保格式正确。

**Files:** 无新增；只跑命令验证。

- [ ] **Step 1: 准备测试 history**

```bash
# 在仓库根，确保 dev-20260606 是最新
git log --oneline -5
```

应该看到本 plan 期间产生的多个 commit，包括至少 1 个 feat 和 1 个 fix。

如果没有 feat/fix commit，可以手动加一个示例（仅测试用，事后 revert）：

```bash
# 临时加一个 test 提交，不真改代码
echo "// test" >> client/src/_test_marker.ts
git add client/src/_test_marker.ts
git commit -m "feat(client): 临时测试条目（事后 revert）"
# 跑完测试后 revert
```

- [ ] **Step 2: 跑脚本**

```bash
LAST=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
bash .github/scripts/render-release-notes.sh "$LAST"
```

- [ ] **Step 3: 检查输出**

输出应包含：

- 标题 `## my-ai release-YYYYMMDD-{sha} (YYYY-MM-DD)`
- `### 子项目版本` 段
- `### 兼容矩阵` 段
- `### 功能变更` 段（如有 feat commit 在 client/gateway/core 路径下，列出对应子项目）
- `### Bug 修复` 段（如有 fix commit）
- `### 兼容性变更` 段（如有 matrix 改动）

- [ ] **Step 4: 清理（如果有临时 commit）**

```bash
git revert HEAD --no-edit  # 或直接 reset 到测试前
```

- [ ] **Step 5: 跑三件套**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: 全 PASS

- [ ] **Step 6: Commit（如有需要）**

如果只是验证脚本输出，无需 commit；如调整了脚本内容，commit。

---

### Task 6.2：触发首次 release

**目的**：把当前 main 上的提交触发一次 baseline release，验证完整 CI + release 流程。

**Files:** 无；纯运维动作。

- [ ] **Step 1: 确认 main 是最新**

```bash
git checkout main
git pull origin main
```

- [ ] **Step 2: 推 dev-20260606 到远程并开 PR**

```bash
git checkout dev-20260606
git push origin dev-20260606
```

然后用 `gh pr create --base main --head dev-20260606 --title "v2: 三端版本同步与兼容机制" --body "..."`。

- [ ] **Step 3: 等 CI 全绿**

等 compat-matrix-check / version-bump-check / quality / build-\* 全部通过。

- [ ] **Step 4: 用 --squash 合入 main**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 5: 验证 release workflow 自动跑出 release**

`gh release list` 看到刚出的 release。

`gh release view {tag}` 看到 body 符合 spec §5.10 模板。

- [ ] **Step 6: 把这条 release 标为 "baseline"**

`gh release edit {tag} --notes "..."`（追加 baseline 标记）

---

## Phase 7：手工 E2E

### Task 7.1：跨三端真实装包冒烟

**目的**：跑 spec §5.13 (g) 列表里的手工 E2E，确认真实环境无误。

**Files:** 无；执行 + 记录。

- [ ] **Step 1: 装三端**

按 v1 README 走：装 client（Tauri 安装包）、启动 gateway 和 core（pnpm dev 或 build + start）。

- [ ] **Step 2: 验证 HEALTHY 路径**

启动 client → 配 gateway URL → 看到"配对成功 · gateway v2.0.0"。

- [ ] **Step 3: 模拟 gateway 升级**

手动把 gateway 端的 `dist/../.compat.generated.json` 改成 `{"version": "1.0.0", "upstream": {}}`，不重启 gateway，client heartbeat 后看到 MISMATCH + banner。

- [ ] **Step 4: 验证 banner 关闭 session sticky**

点关闭 banner。等下次 heartbeat 5 min（fake 一下：等几秒调一下 client 端的 `HEARTBEAT_MS` env）。banner 仍收起。

- [ ] **Step 5: 验证进程重启重置**

关掉 client、重启。banner 重新显示。

- [ ] **Step 6: 故意把 matrix 写坏**

把 `versions/compat-matrix.json` 里的 `schema` 改成 2，PR 跑 CI 看 `compat-matrix-check` job 是否红。

回滚。

- [ ] **Step 7: 故意不 bump version**

开一个 PR 改 `client/src/styles.css` 但不改 `client/package.json` version。CI `version-bump-check` 是否红。

回滚。

- [ ] **Step 8: 写 E2E 报告**

在 `versions/v2.md` 末尾追加 "E2E 验证记录" 段（日期 + 结果），commit。

---

## Phase 8：收尾

### Task 8.1：补 v2.md 引用 v1 已知问题

**目的**：v1.md 第 5 项遗留的 "Dependabot 三个开关" 问题在 v2 仍未解决（不在 v2 scope），但 v2 文档应明确引用 v1 这条遗留。

**Files:**

- Modify: `versions/v2.md`

- [ ] **Step 1: 在 v2.md §八 待处理 加引用**

在 v2.md §八 已有 "Dependabot 三个开关的依赖关系" 条目，加注：

```markdown
- **Dependabot 三个开关的依赖关系**（[v1 §六 第 5 项](./v1.md#六已知问题) 遗留）：与本版本机制正交
```

- [ ] **Step 2: Commit**

```bash
git add versions/v2.md
git commit -m "docs(v2): 待处理段加 v1 遗留问题引用"
```

---

### Task 8.2：推送 dev-20260606

**目的**：本地所有 v2 commit 推上远程，dev 分支保持领先。

**Files:** 无；纯 git 动作。

- [ ] **Step 1: 推**

```bash
git push origin dev-20260606
```

- [ ] **Step 2: 验证远程**

```bash
git log origin/dev-20260606 --oneline -10
```

期望：本 plan 期间的所有 commit 都在。

---

## 自审检查

### Spec 覆盖

| spec 章节                                 | 对应 Task                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| §5.1 架构总览（state machine）            | Task 4.5                                                                             |
| §5.2 顶层数据模型                         | Task 1.1                                                                             |
| §5.3 Distribution（sync 脚本）            | Task 1.2, 1.3, 1.4, 1.5                                                              |
| §5.4 `/health` 扩展                       | Task 2.4, 3.2                                                                        |
| §5.5 Handshake + Heartbeat 协议           | Task 4.2, 4.5                                                                        |
| §5.6 客户端状态机                         | Task 4.5                                                                             |
| §5.7 Banner 行为规则                      | Task 4.3, 4.5                                                                        |
| §5.8 Pairing UI                           | Task 4.4                                                                             |
| §5.9 发布流程（version bump）             | Task 5.2, 5.3, 6.1, 6.2                                                              |
| §5.10 Release body 模板                   | Task 5.3, 6.1                                                                        |
| §5.11 错误处理（loud/soft）               | Task 2.3, 3.2, 5.1, 5.2                                                              |
| §5.12 CI job 清单                         | Task 5.1, 5.2, 5.3                                                                   |
| §5.13 测试策略（unit/集成/组件/手工 E2E） | Task 1.2/1.3/2.1/2.2/2.4/3.1/3.2/4.1-4.5（单元 + 集成 + 组件）；Task 7.1（手工 E2E） |

### 占位符扫描

无 "TBD" / "TODO" / "fill in"。所有 code block 完整。

### 类型一致性

- `checkCompat(got, want): boolean` 在 core / gateway / client 三处签名一致
- `Compat` type 在 `compat/load.ts` 中 export，三处 import
- `HandshakeStatus = 'PAIRING' | 'HEALTHY' | 'MISMATCH' | 'PAIR_FAILED'` 在 handshake.ts export，App.tsx + Settings.tsx + App.test.tsx 引用
- `app.compat` 装饰在 core 和 gateway 的 `buildServer` 中注入，`FastifyInstance` 类型扩展两处一致
- `.compat.generated.json` schema（`{version, upstream}`）与 `loadCompat` 解析一致

### 缺口

- client URL 持久化（tauri-plugin-store）暂未实现——spec 提到但 v2 阶段用环境变量占位；不影响 compat 机制正确性，留 v3 接入
- `app.decorate('compat', ...)` 在 core 和 gateway 的 server.ts 都做了，但 routes/agents.ts、routes/chat.ts 还未使用 `app.compat`——本 plan 不扩展这两个路由，handler 签名不变
