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
