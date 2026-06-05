// 客户端根组件：当前是个最小骨架，演示如何从环境变量读取 gateway 地址并探测其健康状态。
// 后续会扩展为多 agent 切换、消息流、工具调用面板等。

import { useEffect, useState } from 'react';

type Health = { ok: boolean; service: string };

// 默认指向本地 gateway；打包时可通过 .env 中的 VITE_GATEWAY_URL 覆盖。
const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://127.0.0.1:8787';

function App() {
  // gateway 健康状态；null 表示尚未拿到响应。
  const [health, setHealth] = useState<Health | null>(null);
  // 拉取过程中出现的错误信息（网络失败、CORS 等）。
  const [error, setError] = useState<string | null>(null);

  // 启动时拉一次 gateway 健康检查，仅用于演示连通性。
  useEffect(() => {
    fetch(`${GATEWAY_URL}/health`)
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main className="app">
      <h1>my-ai client</h1>
      <p className="muted">Tauri + React skeleton</p>

      <section>
        <h2>Gateway status</h2>
        <p>
          URL: <code>{GATEWAY_URL}</code>
        </p>
        {error && <p className="error">error: {error}</p>}
        {!error && !health && <p>checking…</p>}
        {health && (
          <p>
            <span className="dot" data-ok={health.ok} /> {health.service} —{' '}
            {health.ok ? 'ok' : 'down'}
          </p>
        )}
      </section>
    </main>
  );
}

export default App;
