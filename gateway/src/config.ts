// 网关配置加载：用 zod 校验环境变量，启动期失败比运行期失败更安全。
import { z } from 'zod';

const Schema = z.object({
  // 监听端口，默认 8787（前端 VITE_GATEWAY_URL 默认值要保持一致）。
  PORT: z.coerce.number().int().positive().default(8787),
  // 监听地址。
  HOST: z.string().default('127.0.0.1'),
  // 上游 core 地址。
  CORE_URL: z.string().url().default('http://127.0.0.1:8788'),
  // 日志等级。
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // CORS 白名单，逗号分隔字符串。
  CORS_ORIGINS: z.string().default('http://localhost:5173,tauri://localhost'),
});

export type Config = z.infer<typeof Schema>;

/**
 * 加载并校验环境变量；校验失败直接退出，避免半配置状态下启动。
 */
export function loadConfig(): Config {
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid gateway config:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}
