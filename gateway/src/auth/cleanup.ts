// 网关过期清理任务：定时删除 last_seen_at 超过 TTL 的 client 记录。
// Task 4.2 会把下面的 stub 替换为真实实现（setInterval + deleteExpiredClients）。
// 这里只暴露同名的 start/stop 接口，让 server.ts 的集成可以先跑通 typecheck。
import type {
  FastifyInstance,
  FastifyBaseLogger,
  FastifyTypeProvider,
  FastifyTypeProviderDefault,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerBase,
} from 'fastify';

/**
 * 启动周期性清理任务：每 ttlMs 跑一次 deleteExpiredClients(now - ttlMs)。
 * stub 阶段不真正启动 timer，等 Task 4.2 实现。
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
  _app: FastifyInstance<
    RawServer,
    RawRequestDefaultExpression<RawServer>,
    RawReplyDefaultExpression<RawServer>,
    Logger,
    TypeProvider
  >,
  _ttlMs: number,
): void {
  // stub: Task 4.2 替换为 setInterval + log
}

/**
 * 停止清理任务：测试或优雅退出时调用。
 * stub 阶段 no-op。
 */
export function stopCleanupTask(): void {
  // stub: Task 4.2 替换为 clearInterval
}
