// 网关配置加载：用 zod 校验环境变量，启动期失败比运行期失败更安全。
import { z } from 'zod';

const Schema = z.object({
  // 监听端口，默认 8787（前端 VITE_GATEWAY_URL 默认值要保持一致）。
  PORT: z.coerce.number().int().positive().default(8787),
  // 监听地址；dev 默认 0.0.0.0（任意 IP 可连，方便 LAN/Docker/SSH 隧道调试）。
  // 生产部署如要限制到具体网卡，env 显式 override。
  HOST: z.string().default('0.0.0.0'),
  // 上游 core 地址。
  CORE_URL: z.string().url().default('http://127.0.0.1:8788'),
  // 日志等级。
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // CORS 白名单，逗号分隔字符串。'*' 表示反射请求 origin（dev 友好）。
  // 生产环境务必改为具体 origin 列表（多个用逗号分隔）。
  CORS_ORIGINS: z.string().default('*'),

  // === v3 新增：远程配对与鉴权 ===
  // 配对是否公开：true=自由配对, false=需要配对码解析/或 pair key
  GATEWAY_PAIRING_PUBLIC: z.coerce.boolean().default(false),
  // 网关层配对 key：匹配即配对（任何模式都 bypass code 流程）
  GATEWAY_PAIR_KEY: z.string().optional(),
  // 客户端唯一键保存时效（秒）；0 或不配 → 不启动清理
  GATEWAY_PAIRING_KEY_TTL: z.coerce.number().int().min(0).optional(),
  // SQLite DB 文件路径
  GATEWAY_DB_PATH: z.string().default('./gateway.db'),
});

export type Config = z.infer<typeof Schema>;

/**
 * 加载并校验环境变量；校验失败直接退出，避免半配置状态下启动。
 * 接受可选 env 参数以支持测试。
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Schema.safeParse(env);
  if (!parsed.success) {
    console.error('Invalid gateway config:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}
