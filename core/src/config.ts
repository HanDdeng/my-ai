// core 配置加载：zod 校验环境变量。
import { z } from 'zod';

const Schema = z.object({
  // 监听端口，默认 8788（gateway CORE_URL 默认值要保持一致）。
  PORT: z.coerce.number().int().positive().default(8788),
  HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,tauri://localhost'),
  // LLM 抽象层选 provider；后续接 OpenAI/Anthropic 兼容协议时按需扩展。
  LLM_PROVIDER: z.enum(['mock', 'openai-compatible']).default('mock'),
  LLM_BASE_URL: z.string().url().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('gpt-4o-mini'),
});

export type Config = z.infer<typeof Schema>;

/**
 * 加载并校验环境变量；校验失败直接退出。
 */
export function loadConfig(): Config {
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid core config:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}
