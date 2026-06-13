/// <reference types="vite/client" />

// Vite 注入的 import.meta.env 类型扩展。
// 当前声明了前端用到的所有 VITE_* 环境变量，加新变量时同步扩展。

interface ImportMetaEnv {
  // 网关层 HTTP 地址，前端通过它调用 gateway。
  readonly VITE_GATEWAY_URL?: string;
  // v6.5: 客户端版本号，由 vite.config.ts 在编译时从 client/package.json 注入。
  // 避免在 App.tsx 等组件里硬编码 "0.0.4" 这种长期不更新的字符串。
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
