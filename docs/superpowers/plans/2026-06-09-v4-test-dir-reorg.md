# v4 — 测试目录统一到 test/ + tsconfig path alias 化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 32 个测试文件 + 1 个 setup.ts 统一迁出 `src/`，放到 `<subproject>/test/` 下与 `src/` 镜像；将测试中 20 处相对 import 改写为 tsconfig path alias `@/*` 形式；不 bump 版本号、不改任何被测代码。

**Architecture:** 测试代码与生产代码物理分离；`test/` 与 `src/` 严格镜像；通过 tsconfig `paths: { "@/*": ["./src/*"] }`（已存在）+ vitest `resolve.alias` 解耦测试位置与被测代码位置。git 用 `git mv` 保留 rename history。

**Tech Stack:** pnpm 10 workspaces、Vitest 2.1、TypeScript 5.5、commitlint、husky

**Spec:** [`versions/v4.md`](../../../versions/v4.md)

---

## 总览：1 个 Phase，6 个 Task

| Task | 内容                                                                    | 涉及文件数   |
| ---- | ----------------------------------------------------------------------- | ------------ |
| 1    | 准备工作 + 前置状态确认                                                 | 0            |
| 2    | 更新 6 个配置文件（3 tsconfig + 3 vitest）                              | 6            |
| 3    | `git mv` 33 个文件到 test/（11 client + 16 gateway + 5 core + 1 setup） | 33           |
| 4    | 改写 20 处相对 import 为 `@/*` 形式（3 client + 15 gateway + 2 core）   | 20 处 import |
| 5    | 清理 + 全工作区验证                                                     | 1 dir 删除   |
| 6    | 提交 + 推送                                                             | 1 commit     |

**约束**：

- 每 task 完成后跑 `pnpm -r typecheck && pnpm -r test` 两件套，全绿才能进下个 task
- 改写 import 后必须看到 `pnpm -r test` 全绿，**才**能 commit
- 失败回退到上一个 commit（用 `git reset --hard HEAD` 而非 `git revert`，因为还没 push）

**关键变更提示**：

- 三个 tsconfig 的 `paths: { "@/*": ["./src/*"] }` **已存在**，不要重新加
- 三个 vitest.config.ts 需要加 `import { fileURLToPath } from 'node:url'` 和 `resolve.alias` 块
- client 唯一带 `setup.ts`，路径从 `src/test/setup.ts` 改为 `test/setup.ts`
- gateway + core 的 vitest.config.ts 当前**没有** `setupFiles`，**不要**加
- 不需要改 `tsconfig.base.json`、`pnpm-workspace.yaml`、`.gitignore`、`package.json` 任何字段

---

## Phase 1：测试目录重组

### Task 1：准备工作 + 前置状态确认

**Files:** 无

- [ ] **Step 1：确认在 dev-20260609 分支**

Run:

```bash
git branch --show-current
```

Expected: `dev-20260609`（不是 `main`，不是其他分支）

- [ ] **Step 2：确认 working tree 干净**

Run:

```bash
git status
```

Expected: `nothing to commit, working tree clean`

- [ ] **Step 3：确认前置 commit 存在（v4 设计文档已提交）**

Run:

```bash
git log --oneline -2
```

Expected: 看到

```
798cd0d docs(v4): 设计文档——测试目录统一到 test/ + tsconfig path alias 化
b984fac v3: 网关远程配对与鉴权（含 gateway cli 双 listen 修复 + 移除 pnpm 版本锁定） (#31)
```

- [ ] **Step 4：确认未 push**

Run:

```bash
git log --oneline origin/dev-20260609..HEAD 2>/dev/null || echo "(no remote branch yet — 还没推过)"
```

Expected: 空输出（本地领先 0 commit）或 `(no remote branch yet — 还没推过)`

- [ ] **Step 5：确认测试在 src/ 下、配置 include 指向 src/**

Run:

```bash
find client/src gateway/src core/src -name "*.test.ts" -o -name "*.test.tsx" | wc -l
```

Expected: `32`（11 client + 16 gateway + 5 core）

如果数量不是 32，**停止**并排查缺失/多余文件，不要继续。

- [ ] **Step 6：基线测试运行（应该全绿）**

Run:

```bash
pnpm -r run test 2>&1 | tail -20
```

Expected: 看到 `Test Files N passed (N)` 其中 N 总和为 32，**没有任何 failed**

如果基线都不绿，**停止**，先修 v3 留下的 bug，再继续 v4。

- [ ] **Step 7：基线 typecheck（应该全绿）**

Run:

```bash
pnpm -r run typecheck 2>&1 | tail -10
```

Expected: 三个子项目都 `Done` 无报错

---

### Task 2：更新 6 个配置文件

**Files:**

- Modify: `client/tsconfig.json`
- Modify: `client/vitest.config.ts`
- Modify: `gateway/tsconfig.json`
- Modify: `gateway/vitest.config.ts`
- Modify: `core/tsconfig.json`
- Modify: `core/vitest.config.ts`

- [ ] **Step 1：修改 `client/tsconfig.json`**

打开 `client/tsconfig.json`，将 `"include": ["src"]` 改为 `"include": ["src", "test"]`：

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "types": ["vite/client"],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 2：修改 `client/vitest.config.ts`**

完整重写文件为：

```ts
// 客户端 Vitest 配置：测试文件位于 test/ 目录（v4 重构）。
// v1 仅做最小冒烟；后续补 @testing-library/react 等再做组件测试。
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    globals: true,
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
  // v4: 让 test 内的 @/foo/bar 解析到 src/foo/bar
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
```

- [ ] **Step 3：修改 `gateway/tsconfig.json`**

打开 `gateway/tsconfig.json`，将 `"include": ["src"]` 改为 `"include": ["src", "test"]`：

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 4：修改 `gateway/vitest.config.ts`**

完整重写文件为：

```ts
// gateway 的 Vitest 配置：测试文件位于 test/ 目录（v4 重构）。
// v1 仅做最小冒烟；后续可用 fastify.inject 做路由级测试。
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
  // v4: 让 test 内的 @/foo/bar 解析到 src/foo/bar
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
```

- [ ] **Step 5：修改 `core/tsconfig.json`**

打开 `core/tsconfig.json`，将 `"include": ["src"]` 改为 `"include": ["src", "test"]`：

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 6：修改 `core/vitest.config.ts`**

完整重写文件为：

```ts
// core 的 Vitest 配置：测试文件位于 test/ 目录（v4 重构）。
// v1 仅做最小冒烟；所有源码都是后端 TS，Node 环境即可。
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
  // v4: 让 test 内的 @/foo/bar 解析到 src/foo/bar
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
```

- [ ] **Step 7：验证 6 个文件改动正确**

Run:

```bash
grep -A 1 '"include"' client/tsconfig.json gateway/tsconfig.json core/tsconfig.json
```

Expected: 三行 `"include": ["src", "test"]`

Run:

```bash
grep -l "resolve.alias\|resolve:" client/vitest.config.ts gateway/vitest.config.ts core/vitest.config.ts
```

Expected: 三个文件都命中

Run:

```bash
grep "include:" client/vitest.config.ts gateway/vitest.config.ts core/vitest.config.ts
```

Expected: 看到 `include: ['test/**/*.test.{ts,tsx}']`（client）+ `include: ['test/**/*.test.ts']`（gateway + core）

- [ ] **Step 8：故意不跑测试——此时测试会失败（预期）**

此时不应跑 `pnpm -r run test`，因为：

- vitest `include` 已经是 `test/**/*.test.ts`
- 但测试文件还在 `src/` 下
- 所以 vitest 找不到任何测试，会显示 0 tests

**这是预期行为**，继续到 Task 3 移动文件即可。

如果你想确认，可以用 `--reporter=verbose` 跑一次，看到 0 tests collected 即说明 include 改对了：

Run:

```bash
pnpm --filter @my-ai/gateway exec vitest run --reporter=verbose 2>&1 | tail -5
```

Expected: `No test files found` 或 `Test Files 0 passed (0)` 类似输出

---

### Task 3：移动 33 个文件到 test/（用 `git mv` 保留 rename history）

**Files:**

- Move (git mv): 33 个文件（11 client + 16 gateway + 5 core + 1 setup）

#### Task 3.1：移动 client 端 12 个文件

- [ ] **Step 1：`git mv` client 端 11 个测试 + 1 个 setup.ts**

Run:

```bash
cd client
git mv src/App.test.tsx test/App.test.tsx
git mv src/compat/check.test.ts test/compat/check.test.ts
git mv src/compat/handshake.test.ts test/compat/handshake.test.ts
git mv src/components/MismatchBanner.test.tsx test/components/MismatchBanner.test.tsx
git mv src/components/PairBanner.test.tsx test/components/PairBanner.test.tsx
git mv src/components/PairDialog.test.tsx test/components/PairDialog.test.tsx
git mv src/components/Settings.test.tsx test/components/Settings.test.tsx
git mv src/components/ThemeToggle.test.tsx test/components/ThemeToggle.test.tsx
git mv src/lib/api.test.ts test/lib/api.test.ts
git mv src/lib/secure-store.test.ts test/lib/secure-store.test.ts
git mv src/lib/uuid.test.ts test/lib/uuid.test.ts
git mv src/test/setup.ts test/setup.ts
cd ..
```

Expected: 12 行 `Renaming ...` 或静默成功（无错误）

- [ ] **Step 2：验证 client 端 12 个文件就位**

Run:

```bash
find client/test -type f -name "*.ts" -o -name "*.tsx" | sort
```

Expected: 12 行（11 个 `.test.ts(x)` + `setup.ts`），例如：

```
client/test/App.test.tsx
client/test/compat/check.test.ts
client/test/compat/handshake.test.ts
client/test/components/MismatchBanner.test.tsx
client/test/components/PairBanner.test.tsx
client/test/components/PairDialog.test.tsx
client/test/components/Settings.test.tsx
client/test/components/ThemeToggle.test.tsx
client/test/lib/api.test.ts
client/test/lib/secure-store.test.ts
client/test/lib/uuid.test.ts
client/test/setup.ts
```

- [ ] **Step 3：验证 client/src 残留**

Run:

```bash
find client/src -name "*.test.ts" -o -name "*.test.tsx"
```

Expected: **空**（0 行输出）

- [ ] **Step 4：验证 client/src/test/ 是否还有内容**

Run:

```bash
ls client/src/test 2>/dev/null
```

Expected: `ls: cannot access 'client/src/test': No such file or directory` 或空目录

如果还有内容，**停止**并排查（可能是漏 `git mv` 的文件）。

#### Task 3.2：移动 gateway 端 16 个文件

- [ ] **Step 5：`git mv` gateway 端 16 个测试文件**

Run:

```bash
cd gateway
git mv src/auth/cleanup.test.ts test/auth/cleanup.test.ts
git mv src/auth/hash.test.ts test/auth/hash.test.ts
git mv src/auth/middleware.test.ts test/auth/middleware.test.ts
git mv src/auth/public-paths.test.ts test/auth/public-paths.test.ts
git mv src/auth/store.test.ts test/auth/store.test.ts
git mv src/clients/core.test.ts test/clients/core.test.ts
git mv src/compat/check.test.ts test/compat/check.test.ts
git mv src/compat/load.test.ts test/compat/load.test.ts
git mv src/config.test.ts test/config.test.ts
git mv src/db.test.ts test/db.test.ts
git mv src/response.test.ts test/response.test.ts
git mv src/routes/health.test.ts test/routes/health.test.ts
git mv src/routes/internal/clients.test.ts test/routes/internal/clients.test.ts
git mv src/routes/internal/pair-resolve.test.ts test/routes/internal/pair-resolve.test.ts
git mv src/routes/pair-status.test.ts test/routes/pair-status.test.ts
git mv src/routes/pair.test.ts test/routes/pair.test.ts
cd ..
```

Expected: 16 行 `Renaming ...` 或静默成功

- [ ] **Step 6：验证 gateway 端 16 个文件就位**

Run:

```bash
find gateway/test -type f -name "*.test.ts" | sort | wc -l
```

Expected: `16`

- [ ] **Step 7：验证 gateway/src 残留**

Run:

```bash
find gateway/src -name "*.test.ts" -o -name "*.test.tsx"
```

Expected: **空**（0 行输出）

#### Task 3.3：移动 core 端 5 个文件

- [ ] **Step 8：`git mv` core 端 5 个测试文件**

Run:

```bash
cd core
git mv src/agent/registry.test.ts test/agent/registry.test.ts
git mv src/compat/check.test.ts test/compat/check.test.ts
git mv src/compat/load.test.ts test/compat/load.test.ts
git mv src/llm/mock.test.ts test/llm/mock.test.ts
git mv src/routes/health.test.ts test/routes/health.test.ts
cd ..
```

Expected: 5 行 `Renaming ...` 或静默成功

- [ ] **Step 9：验证 core 端 5 个文件就位**

Run:

```bash
find core/test -type f -name "*.test.ts" | sort | wc -l
```

Expected: `5`

- [ ] **Step 10：验证 core/src 残留**

Run:

```bash
find core/src -name "*.test.ts" -o -name "*.test.tsx"
```

Expected: **空**（0 行输出）

#### Task 3.4：检查 git rename 状态

- [ ] **Step 11：检查 git status 应该看到 33 个 rename**

Run:

```bash
git status --short
```

Expected: 看到 **33 行 `R` 状态**（每行类似 `R  client/src/App.test.tsx -> client/test/App.test.tsx`），加上 6 个 `M` 状态（3 tsconfig + 3 vitest）

**不应该**看到任何 `D`（delete）或 `A`（add）针对测试文件的状态

如果看到 add+delete 而非 rename，**停止**并排查（你可能用了 `mv` 而非 `git mv`，或漏了某些文件）。

- [ ] **Step 12：粗略跑一次 vitest——预期 import 报错，但能找到文件**

Run:

```bash
pnpm -r run test 2>&1 | tail -30
```

Expected:

- 能看到每个 test file 被 collect 起来（不再 `No test files found`）
- 但每个测试应该 fail with `Cannot find module '../foo/bar.js'` 或 `'../../db.js'` 等
- **这是预期行为**——Task 4 会改 import

如果仍显示 `No test files found`，说明 `git mv` 后 vitest 的 `include` 没匹配到新位置，**停止**并排查 vitest config。

---

### Task 4：改写 20 处相对 import 为 `@/*` 形式

**Files:**

- Modify: 13 个测试文件（3 client + 8 gateway + 2 core）

> **改写规则**（来自 versions/v4.md §5.4）：
>
> 1. 把 `'../<x>.js'` 去掉深度，改为 `'@/<x>.js'`（**保留 `.js` 后缀**——与 `moduleResolution: Bundler` 风格一致）
> 2. 同目录的 `'./foo.js'` 也改为 `'@/foo.js'`（统一规则）
> 3. `'vitest'` 等 npm 包 import 不动
> 4. 类型 import `import type { ... } from '../foo.js'` 一并改

#### Task 4.1：client 端 3 处 import

- [ ] **Step 1：修改 `client/test/compat/handshake.test.ts`**

打开 `client/test/compat/handshake.test.ts`，将第 5 行：

```ts
import { COMPAT } from '../compat.generated.js';
```

改为：

```ts
import { COMPAT } from '@/compat.generated.js';
```

- [ ] **Step 2：修改 `client/test/components/PairDialog.test.tsx`**

打开 `client/test/components/PairDialog.test.tsx`，将第 22 行：

```ts
import { apiFetch, ApiError } from '../lib/api.js';
```

改为：

```ts
import { apiFetch, ApiError } from '@/lib/api.js';
```

> 注意：还有一行 `vi.mock('../lib/api.js', ...)` 在文件中是 **mock 路径**，也必须改。找到 `vi.mock('../lib/api.js',` 改为 `vi.mock('@/lib/api.js',`。这个改写在 mock 模块路径里也生效。

- [ ] **Step 3：修改 `client/test/components/Settings.test.tsx`**

打开 `client/test/components/Settings.test.tsx`，将第 5 行：

```ts
import type { HandshakeStatus } from '../compat/handshake.js';
```

改为：

```ts
import type { HandshakeStatus } from '@/compat/handshake.js';
```

#### Task 4.2：gateway 端 15 处 import

- [ ] **Step 4：修改 `gateway/test/routes/health.test.ts`**

打开 `gateway/test/routes/health.test.ts`，将第 9 行：

```ts
import type { Compat } from '../compat/load.js';
```

改为：

```ts
import type { Compat } from '@/compat/load.js';
```

- [ ] **Step 5：修改 `gateway/test/routes/pair.test.ts`（4 处）**

打开 `gateway/test/routes/pair.test.ts`，将第 4-7 行：

```ts
import { openDatabase } from '../db.js';
import { AuthStore } from '../auth/store.js';
import { sha256 } from '../auth/hash.js';
import { authMiddleware } from '../auth/middleware.js';
```

改为：

```ts
import { openDatabase } from '@/db.js';
import { AuthStore } from '@/auth/store.js';
import { sha256 } from '@/auth/hash.js';
import { authMiddleware } from '@/auth/middleware.js';
```

- [ ] **Step 6：修改 `gateway/test/routes/internal/clients.test.ts`（2 处）**

打开 `gateway/test/routes/internal/clients.test.ts`，将第 4-5 行：

```ts
import { openDatabase } from '../../db.js';
import { AuthStore } from '../../auth/store.js';
```

改为：

```ts
import { openDatabase } from '@/db.js';
import { AuthStore } from '@/auth/store.js';
```

- [ ] **Step 7：修改 `gateway/test/routes/internal/pair-resolve.test.ts`（2 处）**

打开 `gateway/test/routes/internal/pair-resolve.test.ts`，将第 4-5 行：

```ts
import { openDatabase } from '../../db.js';
import { AuthStore } from '../../auth/store.js';
```

改为：

```ts
import { openDatabase } from '@/db.js';
import { AuthStore } from '@/auth/store.js';
```

- [ ] **Step 8：修改 `gateway/test/auth/cleanup.test.ts`（1 处）**

打开 `gateway/test/auth/cleanup.test.ts`，将第 4 行：

```ts
import { openDatabase } from '../db.js';
```

改为：

```ts
import { openDatabase } from '@/db.js';
```

- [ ] **Step 9：修改 `gateway/test/routes/pair-status.test.ts`（3 处）**

打开 `gateway/test/routes/pair-status.test.ts`，将第 4-6 行：

```ts
import { openDatabase } from '../db.js';
import { AuthStore } from '../auth/store.js';
import { authMiddleware } from '../auth/middleware.js';
```

改为：

```ts
import { openDatabase } from '@/db.js';
import { AuthStore } from '@/auth/store.js';
import { authMiddleware } from '@/auth/middleware.js';
```

- [ ] **Step 10：修改 `gateway/test/auth/middleware.test.ts`（1 处）**

打开 `gateway/test/auth/middleware.test.ts`，将第 4 行：

```ts
import { openDatabase } from '../db.js';
```

改为：

```ts
import { openDatabase } from '@/db.js';
```

- [ ] **Step 11：修改 `gateway/test/auth/store.test.ts`（1 处）**

打开 `gateway/test/auth/store.test.ts`，将第 3 行：

```ts
import { openDatabase } from '../db.js';
```

改为：

```ts
import { openDatabase } from '@/db.js';
```

#### Task 4.3：core 端 2 处 import

- [ ] **Step 12：修改 `core/test/agent/registry.test.ts`**

打开 `core/test/agent/registry.test.ts`，将第 5 行：

```ts
import { MockLLMClient } from '../llm/mock.js';
```

改为：

```ts
import { MockLLMClient } from '@/llm/mock.js';
```

- [ ] **Step 13：修改 `core/test/routes/health.test.ts`**

打开 `core/test/routes/health.test.ts`，将第 9 行：

```ts
import type { Compat } from '../compat/load.js';
```

改为：

```ts
import type { Compat } from '@/compat/load.js';
```

#### Task 4.4：全局 import 改写验证

- [ ] **Step 14：grep 确认 0 处相对 import 残留**

Run:

```bash
grep -rn "from ['\"]\.\.\?/" client/test gateway/test core/test --include="*.test.ts" --include="*.test.tsx"
```

Expected: **空**（0 行输出）——所有 `../` / `../../` / `./` import 都应已改

如果还有残留，**停止**并手动改完再继续。

- [ ] **Step 15：grep 确认 mock 路径也改了**

Run:

```bash
grep -rn "vi.mock.*\.\./\|vi.mock.*\./" client/test gateway/test core/test --include="*.test.ts" --include="*.test.tsx"
```

Expected: **空**（0 行输出）——所有 `vi.mock('../...', ...)` 也应已改

如果还有残留（特别是 client/test/components/PairDialog.test.tsx），**停止**并手动改完再继续。

- [ ] **Step 16：跑测试——预期全绿**

Run:

```bash
pnpm -r run test 2>&1 | tail -10
```

Expected: 看到

```
Test Files  32 passed (32)
```

或类似的（11 client + 16 gateway + 5 core = 32）

如果仍有失败，最可能的原因是：

- `vi.mock` 路径漏改 → 看错误信息里有没有 `Cannot find module '../lib/api.js'` 之类
- 某条 `import` 漏改 → 同上
- alias 没生效 → 看错误信息里有没有 `@/foo/bar` 找不到

排查后回到对应 Step 重做。

- [ ] **Step 17：跑 typecheck——预期全绿**

Run:

```bash
pnpm -r run typecheck 2>&1 | tail -10
```

Expected: 三个子项目都 `Done` 无报错

如果失败，错误信息应该是 `Cannot find module '@/foo/bar'` 形式——说明 alias 解析有问题，回到 Task 2 排查 vitest.config.ts。

---

### Task 5：清理 + 全工作区验证

**Files:**

- Delete: `client/src/test/` 目录（如果还存在）

- [ ] **Step 1：检查 `client/src/test/` 是否还有内容**

Run:

```bash
ls -la client/src/test 2>/dev/null
```

Expected: `ls: cannot access 'client/src/test': No such file or directory`

如果存在但为空（只剩 `.` 和 `..`），删除：

```bash
rmdir client/src/test
```

如果不为空（还有文件）→ **停止**并排查（漏 `git mv`）。

- [ ] **Step 2：检查 `client/src/` 下无 `*.test.*` 残留**

Run:

```bash
find client/src gateway/src core/src -name "*.test.ts" -o -name "*.test.tsx"
```

Expected: **空**（0 行输出）

如果有输出，**停止**并排查。

- [ ] **Step 3：检查三个子项目 `test/` 下测试数**

Run:

```bash
echo "client: $(find client/test -name "*.test.*" | wc -l)"
echo "gateway: $(find gateway/test -name "*.test.*" | wc -l)"
echo "core: $(find core/test -name "*.test.*" | wc -l)"
```

Expected:

```
client: 11
gateway: 16
core: 5
```

- [ ] **Step 4：跑全工作区三件套**

Run:

```bash
pnpm -r run typecheck 2>&1 | tail -5
pnpm -r run test 2>&1 | tail -5
pnpm -r run lint 2>&1 | tail -5
```

Expected: 三个命令都成功（无错误），test 显示 `Test Files 32 passed (32)`，lint 无 error 输出

- [ ] **Step 5：检查 git status 应该只剩 6 个 M + 33 个 R**

Run:

```bash
git status --short
```

Expected: 39 行

- 33 个 `R`（rename，测试文件 + setup）
- 6 个 `M`（3 tsconfig + 3 vitest）

**不应该**有 `D`、`A`（除了以下例外情况）：

- 若 `client/src/test/` 是空目录被 git 自动追踪，可能需要额外 `git rm` 一下

如果看到 `??`（untracked），**停止**并排查（可能 `client/src/test/` 是空目录残留）。

- [ ] **Step 6：检查 git rename 检测**

Run:

```bash
git diff --cached --diff-filter=R --name-status
```

Expected: 33 行 `R<tab>旧路径<tab>新路径`

- [ ] **Step 7：尝试一次 test 镜像一致性检查**

Run:

```bash
for sub in client gateway core; do
  echo "=== $sub ==="
  diff <(find $sub/src \( -name "*.ts" -o -name "*.tsx" \) ! -name "*.test.*" ! -name "*.generated.*" | sed "s|^$sub/src/||" | sort) \
       <(find $sub/test \( -name "*.test.ts" -o -name "*.test.tsx" \) | sed "s|\.test\.tsx\?$||" | sed "s|^$sub/test/||" | sort -u) \
    | head -20
done
```

Expected: 每个子项目的 diff 输出**应只有以下两类**：

- `src/` 中**未被任何测试覆盖**的源文件（如 `gateway/src/server.ts`）
- `src/` 中**没有对应源文件**的测试文件（应为空，因为 test 都是镜像的）

不应该看到 `test/` 下有任何文件没有 `src/` 对应。

---

### Task 6：提交 + 推送

**Files:**

- Commit: 1 个

- [ ] **Step 1：最终 git status 确认**

Run:

```bash
git status
```

Expected: 39 个文件待 commit（33 R + 6 M），无 untracked

- [ ] **Step 2：stage 所有改动**

Run:

```bash
git add -A
```

Expected: 无输出

- [ ] **Step 3：检查暂存内容**

Run:

```bash
git diff --cached --stat
```

Expected: 看到 33 个 rename + 6 个 modify 的统计

- [ ] **Step 4：commit**

Run:

```bash
git commit -m "refactor(v4): 测试目录统一到 test/ + tsconfig path alias 化"
```

Expected: commit 成功，pre-commit hook 自动跑 typecheck + test，全过

如果 commit 失败：

- 如果是 commitlint 报错（type 不合法）→ 检查 commit message，本 plan 写的就是 `refactor(v4):`，**应该**合法
- 如果是 pre-commit test 失败 → 看输出找失败原因，回到 Task 4 / Task 5 排查

- [ ] **Step 5：验证 commit 内容**

Run:

```bash
git log --oneline -3
git show --stat HEAD | head -50
```

Expected:

- log: 看到 3 个 commit，最新是 v4 refactor
- show: 看到 33 个 R + 6 个 M

- [ ] **Step 6：push（不需要用户确认 push，见 MEMORY）**

Run:

```bash
git push -u origin dev-20260609
```

Expected: 推送成功，看到 `* [new branch] dev-20260609 -> dev-20260609`

- [ ] **Step 7：等待用户确认是否合 MR**

**不要**自己创建 PR 或 merge。push 后停下，告知用户：

- 分支已推：`dev-20260609`
- commit: `<hash> refactor(v4): 测试目录统一到 test/ + tsconfig path alias 化`
- 等待用户审阅 / 决定是否开 PR

---

## 附录 A：失败回退指南

### 任何 Task 失败时的回退步骤

1. **诊断失败原因**——读错误信息，定位到具体 Step
2. **如果改动在 working tree（未 commit）**：
   - `git restore <file>` 回退单个文件
   - 或 `git restore .` 回退所有
3. **如果改动在 commit 里（已 commit）**：
   - `git reset --hard HEAD~1` 回退整个 commit
   - **不要**用 `git revert`（会留下 revert commit）
4. **重新执行失败的 Step**

### 关键失败模式速查

| 症状                                                | 原因                          | 修复                                                                           |
| --------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------ |
| `Cannot find module '@/foo/bar'`                    | vitest `resolve.alias` 没生效 | 检查 `fileURLToPath(new URL('./src', import.meta.url))`                        |
| `No test files found`                               | `include` 路径错              | 检查 vitest.config.ts 的 `include: ['test/**/*.test.{ts,tsx}']`                |
| 测试 fail with `Cannot find module '../foo/bar.js'` | import 漏改                   | grep 找漏掉的相对 import                                                       |
| `tsc` 报 alias 路径错                               | tsconfig `paths` 没生效       | 检查 `baseUrl: "."` 和 `paths: { "@/*": ["./src/*"] }`                         |
| `git status` 显示 add+delete 而非 rename            | 用了 `mv` 而非 `git mv`       | commit 前发现：`git mv` 重做；commit 后发现：可接受（git log --follow 仍能追） |
| `client/src/test/` 删不掉                           | 目录非空                      | 排查漏 `git mv` 的文件                                                         |

## 附录 B：本次重构后的"开发者日常工作流"参考

> 写给 v4 之后的开发者。**这不是 v4 的必做事项**，只是把新约定写下来供后续参考。

### 写新测试

- 放到 `test/<mirror-path>/<name>.test.ts(x)`，与 `src/<mirror-path>/<name>.ts(x)` 镜像
- import 写 `'@/foo/bar'`，不用 `'../foo/bar'`

### 改源码位置（如把 `auth/store.ts` 拆成 `auth/store/index.ts`）

- 测试文件**不需要**跟着改（alias 解耦）
- 只需要 `git mv test/auth/store.test.ts test/auth/store/index.test.ts`（如果想保持镜像）
- 或者连 test 文件都不动（test 仍叫 `store.test.ts`，对应 `auth/store/index.ts`）—— 这时镜像被破坏，可以接受

### Code review 时

- `src/foo/bar.ts` 对应 `test/foo/bar.test.ts`，路径一一对应
- 看测试覆盖率：`<subproject>/coverage/index.html` 仍在原位置生成
