// pino 日志工厂：dev 用 pino-pretty，prod 用结构化 JSON。
import pino, { type LoggerOptions } from 'pino';

/**
 * 构造 pino logger。
 * @param level 日志等级字符串
 */
export function createLogger(level: string) {
  const options: LoggerOptions = { level };
  if (process.env.NODE_ENV !== 'production') {
    options.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss' },
    };
  }
  return pino(options);
}
