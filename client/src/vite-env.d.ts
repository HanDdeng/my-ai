/// <reference types="vite/client" />

// Vite 注入的 import.meta.env 类型扩展。
// 当前声明了前端用到的所有 VITE_* 环境变量，加新变量时同步扩展。

interface ImportMetaEnv {
  // 网关层 HTTP 地址，前端通过它调用 gateway。
  readonly VITE_GATEWAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
