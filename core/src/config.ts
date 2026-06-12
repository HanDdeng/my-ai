// core 配置加载：zod 校验环境变量。
import { z } from 'zod';

const Schema = z.object({
  // 监听端口，默认 8788（gateway CORE_URL 默认值要保持一致）。
  PORT: z.coerce.number().int().positive().default(8788),
  HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,tauri://localhost'),
  // v6.1：LLM 配置下沉到 agents 表（base_url / model / max_tokens / llm_provider）。
  // 仅保留 LLM_API_KEY（env 全局共享，agent 行不存 key）。
  LLM_API_KEY: z.string().optional(),
  // v6.5: core → LLM 上游请求超时（ms）；必须 < gateway 的 CORE_TIMEOUT_MS。
  // 默认 600_000 = 10min，覆盖本地 Ollama 大模型推理。
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  // SQLite 文件路径（相对路径相对 cwd）。默认 ./core.db；测试可用 :memory:。
  CORE_DB_PATH: z.string().default('./core.db'),
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
