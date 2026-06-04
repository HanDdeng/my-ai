import pino, { type LoggerOptions } from 'pino';

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
