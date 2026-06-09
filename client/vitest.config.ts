// 客户端 Vitest 配置：测试文件位于 test/ 目录（v4 重构）。
// v5 放宽：i18n 资源小且与代码同模块稳定，co-locate 测试到 src/i18n/*.test.ts。
// 其它源码模块仍推荐用 test/ 集中放（与构建产物隔离）。
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: [
      'test/**/*.test.{ts,tsx}',
      // v5: i18n 模块允许 co-locate 测试
      'src/i18n/**/*.test.{ts,tsx}',
    ],
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
