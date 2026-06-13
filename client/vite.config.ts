// Vite 构建配置：
// - 启用 @vitejs/plugin-react 支持 React + JSX
// - 端口固定 5173（与 Tauri devUrl 保持一致）
// - alias @/ 指向 src/，便于深层目录引用
// - 编译时读 client/package.json 的 version，注入到 import.meta.env.VITE_APP_VERSION，
//   让 App.tsx 等组件不用硬编码版本字符串。测试时 vitest.config.ts 同步注入。
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string };

export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
