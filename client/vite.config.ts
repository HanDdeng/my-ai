// Vite 构建配置：
// - 启用 @vitejs/plugin-react 支持 React + JSX
// - 端口固定 5173（与 Tauri devUrl 保持一致）
// - alias @/ 指向 src/，便于深层目录引用
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
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
