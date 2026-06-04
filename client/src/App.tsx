import { useEffect, useState } from 'react';

type Health = { ok: boolean; service: string };

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://127.0.0.1:8787';

function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        <p>URL: <code>{GATEWAY_URL}</code></p>
        {error && <p className="error">error: {error}</p>}
        {!error && !health && <p>checking…</p>}
        {health && (
          <p>
            <span className="dot" data-ok={health.ok} /> {health.service} — {health.ok ? 'ok' : 'down'}
          </p>
        )}
      </section>
    </main>
  );
}

export default App;
