# my-ai

桌面级 agent 项目：客户端（桌面 UI）与 agent 服务分离，通过网关层互联，支持多客户端访问 core。

## 目录结构

| 目录       | 职责                                                           | 技术栈                                 |
| ---------- | -------------------------------------------------------------- | -------------------------------------- |
| `client/`  | 桌面应用，UI 与本地系统集成                                    | Tauri 2 + React 18 + TypeScript + Vite |
| `gateway/` | 多客户端访问 core 的网关层，负责路由、鉴权、协议转换、流式代理 | Node.js 20 + Fastify 4 + TypeScript    |
| `core/`    | agent 核心：会话、工具、LLM 调用、OS 自动化                    | Node.js 20 + Fastify 4 + TypeScript    |

## 快速开始

```bash
# 安装依赖（需 pnpm 9+）
pnpm install

# 并行启动所有子项目开发模式
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

- 触发：push 到 `main` 或 `dev-*` 分支，或在 GitHub UI 手动 Run workflow
- 详细 workflow：`.github/workflows/build.yml`

| 平台            | Runner           | Target                                          | 产物                                                    |
| --------------- | ---------------- | ----------------------------------------------- | ------------------------------------------------------- |
| Windows x86_64  | `windows-latest` | `x86_64-pc-windows-msvc`                        | `.msi`（Windows Installer）+ NSIS `.exe`                |
| Linux x86_64    | `ubuntu-latest`  | `x86_64-unknown-linux-gnu`                      | `.deb`（Debian/Ubuntu 包）+ `.AppImage`（免安装可执行） |
| macOS universal | `macos-latest`   | `universal-apple-darwin`（arm64 + x86_64 lipo） | `.app`（应用程序包）+ `.dmg`（安装镜像）                |

占位图标源：`client/assets/icon-source.png`（CI 上由 `tauri icon` 现场生成全套 icons）。

下载方式：push 后在 GitHub 仓库页面 → Actions → 选对应 run → Artifacts。

**首次安装注意事项**

- Windows：未签名，SmartScreen 提示时点"仍要运行"；Win10 需装 WebView2 Runtime。
- macOS：未签名 + 未公证，Apple Silicon 上首次打开需 **右键 → 打开**（或系统设置 → 隐私与安全 → 仍要打开）。
- Linux：`.deb` 双击安装或 `sudo dpkg -i xxx.deb`；`.AppImage` 需 `chmod +x` 后双击运行。
