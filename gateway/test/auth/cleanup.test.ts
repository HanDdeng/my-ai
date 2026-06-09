// auth/cleanup 单元测试：TTL=0 不启动；TTL>0 启动 + 调 cleanup 后过期 client 被删。
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import { openDatabase } from '@/db.js';
import { AuthStore } from '@/auth/store.js';
import { startCleanupTask, stopCleanupTask } from '@/auth/cleanup.js';

describe('startCleanupTask', () => {
  let app: ReturnType<typeof Fastify>;
  let store: AuthStore;

  beforeEach(() => {
    vi.useFakeTimers();
    app = Fastify({ logger: false });
    app.decorate('authStore', new AuthStore(openDatabase(':memory:')));
    store = app.authStore;
  });

  afterEach(() => {
    stopCleanupTask(app);
    vi.useRealTimers();
  });

  it('TTL=0 不启动定时任务', () => {
    startCleanupTask(app, 0);
    expect(app.cleanupInterval).toBeUndefined();
  });

  it('TTL>0 启动定时任务 + 触发后过期 client 被删', () => {
    const now = Date.now();
    store.insertClient({
      id: 'old',
      keyHash: 'old',
      name: null,
      createdAt: now,
      lastSeenAt: now - 10_000,
    });
    startCleanupTask(app, 5); // TTL=5s
    // 间隔 = max(60, min(3600, 5/10=0.5 → ceil=1)) = 60s
    // 触发清理：推进 60s
    vi.advanceTimersByTime(60_000);
    // 此时 Date.now() = now+60s, threshold = (now+60s) - 5*1000 = now+55s
    // old: last_seen_at = now-10s < now+55s → 删除
    expect(store.findByHash('old')).toBeNull();
  });
});
