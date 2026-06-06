// 网关健康检查：纯 ok=true，不做 core 探测（避免 core 抖动时误报网关挂掉）。
// 真实 core 健康度由外部 monitor 通过 /v1/agents 等业务接口间接观察。
// 返回 version 让 client 拿到 handshake 信息；schema 是 compat-matrix 协议版本（当前固定 1）。
import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({
    ok: true,
    service: 'gateway',
    version: app.compat.version,
    schema: 1,
  }));
}
