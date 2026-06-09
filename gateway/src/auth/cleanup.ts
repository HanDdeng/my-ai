// 网关过期清理：仅当 GATEWAY_PAIRING_KEY_TTL > 0 启动。
// 间隔 = max(60s, min(3600s, TTL/10))；调 cleanup() 删除 last_seen_at < now-TTL 的 client。
import type {
  FastifyInstance,
  FastifyBaseLogger,
  FastifyTypeProvider,
  FastifyTypeProviderDefault,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerBase,
} from 'fastify';
import type { AuthStore } from './store.js';

declare module 'fastify' {
  interface FastifyInstance {
    authStore: AuthStore;
    cleanupInterval?: NodeJS.Timeout;
  }
}

/**
 * 计算清理间隔：TTL/10 居中到 [60s, 3600s] 区间，避免 TTL 太短时频繁刷 DB，也避免 TTL 太长时永远不删。
 */
function calcIntervalMs(ttlSec: number): number {
  const sec = Math.max(60, Math.min(3600, Math.ceil(ttlSec / 10)));
  return sec * 1000;
}

/**
 * 启动周期性清理：每 intervalMs 跑一次 deleteExpiredClients(now - ttlSec*1000)。
 * TTL=0 或负数时直接 no-op。
 *
 * 泛型签名与 FastifyPluginAsync 同型：接受任意 Logger 的 FastifyInstance，
 * 避免 server.ts 用 pino logger 后 Logger<never, boolean> 与 FastifyBaseLogger
 * 默认泛型不匹配导致 TS2345。
 */
export function startCleanupTask<
  RawServer extends RawServerBase = RawServerBase,
  Logger extends FastifyBaseLogger = FastifyBaseLogger,
  TypeProvider extends FastifyTypeProvider = FastifyTypeProviderDefault,
>(
  app: FastifyInstance<
    RawServer,
    RawRequestDefaultExpression<RawServer>,
    RawReplyDefaultExpression<RawServer>,
    Logger,
    TypeProvider
  >,
  ttlSec: number,
): void {
  if (ttlSec <= 0) {
    return;
  }
  const intervalMs = calcIntervalMs(ttlSec);
  const handler = () => {
    try {
      const threshold = Date.now() - ttlSec * 1000;
      const deleted = app.authStore.deleteExpiredClients(threshold);
      if (deleted > 0) {
        app.log.info({ deleted }, 'cleanup: removed expired clients');
      }
    } catch (e) {
      app.log.warn({ err: e }, 'cleanup failed');
    }
  };
  app.cleanupInterval = setInterval(handler, intervalMs);
  app.log.info({ ttlSec, intervalMs }, 'cleanup task started');
}

/**
 * 停止清理任务：测试或优雅退出时调用；幂等。
 */
export function stopCleanupTask<
  RawServer extends RawServerBase = RawServerBase,
  Logger extends FastifyBaseLogger = FastifyBaseLogger,
  TypeProvider extends FastifyTypeProvider = FastifyTypeProviderDefault,
>(
  app: FastifyInstance<
    RawServer,
    RawRequestDefaultExpression<RawServer>,
    RawReplyDefaultExpression<RawServer>,
    Logger,
    TypeProvider
  >,
): void {
  if (app.cleanupInterval) {
    clearInterval(app.cleanupInterval);
    delete app.cleanupInterval;
  }
}
