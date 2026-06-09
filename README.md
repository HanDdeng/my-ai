# my-ai

桌面级 agent 项目：客户端（桌面 UI）与 agent 服务分离，通过网关层互联，支持多客户端访问 core。

## 目录结构

| 目录       | 职责                                                           | 技术栈                                 |
| ---------- | -------------------------------------------------------------- | -------------------------------------- |
| `client/`  | 桌面应用，UI 与本地系统集成                                    | Tauri 2 + React 18 + TypeScript + Vite |
| `gateway/` | 多客户端访问 core 的网关层，负责路由、鉴权、协议转换、流式代理 | Node.js 20 + Fastify 4 + TypeScript    |
| `core/`    | agent 核心：会话、工具、LLM 调用、OS 自动化                    | Node.js 20 + Fastify 4 + TypeScript    |

## 快速开始

**前置**（三平台一致）：

- Node.js >= 20（推荐 24，与 CI 一致；项目根有 `.nvmrc`，`nvm use` / `fnm use` 自动切）
- pnpm 10（推荐 `corepack enable && corepack prepare pnpm@10.0.0 --activate`，
  让 Node 自带 corepack 自动管理；`package.json` 的 `packageManager` 字段已锁版本）
- macOS / Linux：自带 bash
- Windows：**用 Git Bash**（Git for Windows 自带），别用 cmd / PowerShell 跑 git 钩子

```bash
# 1. 装依赖（首次）
pnpm install

# 2. 复制 .env 模板（已存在则跳过）
pnpm run setup

# 3. 并行启动所有子项目开发模式
pnpm dev

# 单独启动
pnpm --filter client run dev
pnpm --filter gateway run dev
pnpm --filter core run dev

# 构建 / 类型检查 / 测试
pnpm build
pnpm typecheck
pnpm test
```

### 各平台首次启动注意

- **macOS**：若 `pnpm dev` 报 `pnpm: command not found`，
  跑 `corepack enable && corepack prepare pnpm@10.0.0 --activate`。
  Tauri 桌面端要本地构建时需装 Xcode CLI（`xcode-select --install`）和 Rust 工具链。
- **Windows**：
  - 装 [Git for Windows](https://git-scm.com/download/win) 提供 Git Bash。
  - 务必在 Git Bash 里跑 `pnpm install` / `pnpm dev` / `git commit`，
    PowerShell 与 cmd 不能跑 husky 钩子。
  - Tauri 桌面端要本地构建时需装 [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)、
    Visual Studio Build Tools（C++ workload）和 Rust 工具链。
  - pnpm 在 Windows 上需要符号链接权限（开发者模式或管理员）；
    否则 `pnpm install` 报 `EPERM` 时按提示开开发者模式。
- **Linux**：常规装 Node + pnpm 即可；Tauri 桌面端构建依赖 `libwebkit2gtk-4.1-dev` 等系统包。

## 数据流

```
client (Tauri 桌面)
  │
  │ HTTP / WebSocket (本机或局域网)
  ▼
gateway (Node, Fastify)
  │
  │ gRPC / HTTP (本机或远程)
  ▼
core (Node, Fastify + Agent)
  │
  ▼
LLM / 工具 / OS 自动化
```

## 开发约定

- 所有子项目统一使用 TypeScript 严格模式（继承自 `tsconfig.base.json`）。
- 客户端 ↔ 网关走 REST + WebSocket；网关 ↔ core 走内部 HTTP，未来可换 gRPC。
- 生成的截图、临时数据、构建产物统一在 `data/`、`tmp/` 下，禁止提交到 git。
- 主分支（`main`）禁止直接编辑，所有改动走 `dev-YYYYMMDD` 分支并通过 MR 合入。

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

### 网关环境变量

`gateway/.env.example` 列了完整清单（[点此查看](./gateway/.env.example)）。v3 新增的 4 项：

| 变量                      | 必填 | 默认           | 说明                                                                                |
| ------------------------- | ---- | -------------- | ----------------------------------------------------------------------------------- |
| `GATEWAY_PAIRING_PUBLIC`  | 否   | `false`        | 公开模式开关。`true` = 任何客户端可配对；`false` = 需要配对码或 pair key            |
| `GATEWAY_PAIR_KEY`        | 否   | （空）         | 管理员通道 key。客户端表单提交此值时直接配对（任何模式都 bypass code 流程）         |
| `GATEWAY_PAIRING_KEY_TTL` | 否   | （空）         | 客户端唯一键保存时效（秒）。留空或 `0` = 不启动清理；典型值 `3600`/`86400`/`604800` |
| `GATEWAY_DB_PATH`         | 否   | `./gateway.db` | SQLite 文件路径（相对路径相对 cwd）                                                 |

**配置方式**：

```bash
# 方式 1：复制模板（首次 clone 后）
pnpm setup    # 复制 .env.example → gateway/.env
# 编辑 gateway/.env，按需填入上述变量

# 方式 2：直接 shell 注入（适合容器化 / CI）
GATEWAY_PAIRING_PUBLIC=true \
GATEWAY_PAIR_KEY=admin-secret \
GATEWAY_PAIRING_KEY_TTL=86400 \
node gateway/dist/cli.js start
```

**快速验证**：

```bash
# 公开模式快速测（任何客户端可配对）
GATEWAY_PAIRING_PUBLIC=true node gateway/dist/cli.js start

# 私有模式 + pair key（推荐家用 / 小团队）
GATEWAY_PAIR_KEY=admin-secret node gateway/dist/cli.js start

# 私有模式 + 自动过期清理（1d 失效）
GATEWAY_PAIR_KEY=admin-secret GATEWAY_PAIRING_KEY_TTL=86400 node gateway/dist/cli.js start

# 查看已配对客户端
my-ai-gateway list
```

## 后续计划

- [ ] core 接入 LLM（OpenAI 兼容协议）
- [ ] core 实现 tool registry 与 OS 自动化工具（键鼠 / 屏幕 / shell）
- [ ] gateway 鉴权与会话路由
- [ ] client 多 agent 切换 UI
- [ ] 多 agent 协作与配置中心

## 多平台构建产物

通过 GitHub Actions 在三平台 runner 上并行构建（无需本地 Rust/MSVC 工具链）。

- 触发：向 `main` 发起的 PR，或在 GitHub UI 手动 Run workflow
- 详细 workflow：`.github/workflows/build.yml`

| 平台            | Runner           | Target                                          | 产物                                                    |
| --------------- | ---------------- | ----------------------------------------------- | ------------------------------------------------------- |
| Windows x86_64  | `windows-latest` | `x86_64-pc-windows-msvc`                        | `.msi`（Windows Installer）+ NSIS `.exe`                |
| Linux x86_64    | `ubuntu-latest`  | `x86_64-unknown-linux-gnu`                      | `.deb`（Debian/Ubuntu 包）+ `.AppImage`（免安装可执行） |
| macOS universal | `macos-latest`   | `universal-apple-darwin`（arm64 + x86_64 lipo） | `.app`（应用程序包）+ `.dmg`（安装镜像）                |

占位图标源：`client/assets/icon-source.png`（CI 上由 `tauri icon` 现场生成全套 icons）。

下载方式：PR 页面 → Checks → 选 quality / 平台构建 → Artifacts 即可下载；合入后该 run 仍在 Actions 历史里可见。

**首次安装注意事项**

- Windows：未签名，SmartScreen 提示时点"仍要运行"；Win10 需装 WebView2 Runtime。
- macOS：未签名 + 未公证，Apple Silicon 上首次打开需 **右键 → 打开**（或系统设置 → 隐私与安全 → 仍要打开）。
- Linux：`.deb` 双击安装或 `sudo dpkg -i xxx.deb`；`.AppImage` 需 `chmod +x` 后双击运行。
