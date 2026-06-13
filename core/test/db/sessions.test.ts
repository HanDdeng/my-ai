import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@/db/index.js';
import { AgentsDAO, type AgentRow } from '@/db/agents.js';
import { SessionsDAO, type SessionRow } from '@/db/sessions.js';

describe('SessionsDAO', () => {
  let dir: string;
  let sessions: SessionsDAO;
  let agents: AgentsDAO;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'core-sessions-'));
    const db = openDatabase(join(dir, 'core.db'));
    sessions = new SessionsDAO(db);
    agents = new AgentsDAO(db);
    // 插一个 agent（FK 引用）
    agents.insert({
      id: 'a-1',
      name: 'Echo',
      description: '',
      llm_provider: 'openai-compatible',
      base_url: 'http://localhost:11434/v1',
      model: 'qwen2.5:7b',
      max_tokens: null,
      context_window: null,
      // v6.4: per-agent api_key。
      api_key: null,
      enabled_api: 0,
      system_prompt: '',
      capabilities: '[]',
      created_at: '2026-06-10T00:00:00.000Z',
      updated_at: '2026-06-10T00:00:00.000Z',
    } satisfies AgentRow);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const sample = (overrides: Partial<SessionRow> = {}): SessionRow => ({
    id: 's-1',
    agent_id: 'a-1',
    client_key: 'client-abc',
    title: '',
    created_at: '2026-06-10T00:00:00.000Z',
    updated_at: '2026-06-10T00:00:00.000Z',
    ...overrides,
  });

  it('insert + get + listByAgent + listByClientKey', () => {
    sessions.insert(sample());
    sessions.insert(sample({ id: 's-2', client_key: 'client-xyz' }));
    expect(sessions.get('s-1')?.agent_id).toBe('a-1');
    expect(sessions.listByAgent('a-1')).toHaveLength(2);
    expect(sessions.listByClientKey('client-abc')).toHaveLength(1);
  });

  it('updateTimestamp 改 updated_at', () => {
    sessions.insert(sample());
    sessions.updateTimestamp('s-1', '2026-06-10T01:00:00.000Z');
    expect(sessions.get('s-1')?.updated_at).toBe('2026-06-10T01:00:00.000Z');
  });

  it('delete 删 session', () => {
    sessions.insert(sample());
    sessions.delete('s-1');
    expect(sessions.get('s-1')).toBeNull();
  });

  it('删 agent CASCADE 删 sessions', () => {
    sessions.insert(sample());
    agents.delete('a-1');
    expect(sessions.get('s-1')).toBeNull();
  });
});
