// gateway 的 Vitest 配置：与 core 同样为 Node 环境；后续可用 fastify.inject 做路由级测试。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});
