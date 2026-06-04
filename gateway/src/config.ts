import { z } from 'zod';

const Schema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default('127.0.0.1'),
  CORE_URL: z.string().url().default('http://127.0.0.1:8788'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,tauri://localhost'),
});

export type Config = z.infer<typeof Schema>;

export function loadConfig(): Config {
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid gateway config:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}
