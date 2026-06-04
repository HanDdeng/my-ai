import type { FastifyInstance } from 'fastify';
import type { CoreClient } from '../clients/core.js';

export async function healthRoutes(app: FastifyInstance, core: CoreClient) {
  app.get('/health', async () => {
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
