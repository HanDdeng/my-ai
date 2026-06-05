# @my-ai/client

Tauri 2 + React 18 + TypeScript 桌面客户端。

## 开发

```bash
# 启动 Vite 开发服务（仅前端）
pnpm --filter client run dev

# 启动 Tauri 桌面应用（含 Vite）
pnpm --filter client run tauri dev

# 构建发布包
pnpm --filter client run tauri build
```

## 环境变量

复制 `.env.example` 为 `.env`，可调整 `VITE_GATEWAY_URL` 指向 gateway。

## 目录

```
src/                # React 前端
  main.tsx          # 入口
  App.tsx           # 根组件
  styles.css        # 全局样式
src-tauri/          # Tauri Rust 端
  src/main.rs       # 入口
  src/lib.rs        # 窗口/命令注册
  tauri.conf.json   # Tauri 配置
  capabilities/     # 权限声明
```
