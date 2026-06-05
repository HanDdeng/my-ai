// 健康检查路由：同时汇报网关自身与上游 core 的状态，便于外部监控。
import type { FastifyInstance } from 'fastify';
import type { CoreClient } from '../clients/core.js';

export async function healthRoutes(app: FastifyInstance, core: CoreClient) {
  app.get('/health', async () => {
    // 探测 core：失败不抛出，降级为 ok=false，避免监控误报网关挂掉。
    let coreOk = false;
    try {
      const h = await core.health();
      coreOk = h.ok;
    } catch {
      coreOk = false;
    }
    return { ok: coreOk, service: 'gateway' };
  });
}
