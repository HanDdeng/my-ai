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
