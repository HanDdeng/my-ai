// 客户端 Vitest 配置：默认 jsdom 以支持 React 组件测试。
// v1 仅做最小冒烟；后续补 @testing-library/react 等再做组件测试。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});
