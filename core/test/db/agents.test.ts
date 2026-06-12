import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@/db/index.js';
import { AgentsDAO, type AgentRow } from '@/db/agents.js';

describe('AgentsDAO', () => {
  let dir: string;
  let dao: AgentsDAO;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'core-agents-'));
    dao = new AgentsDAO(openDatabase(join(dir, 'core.db')));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const sample = (overrides: Partial<AgentRow> = {}): AgentRow => ({
    id: 'a-1',
    name: 'Echo',
    description: '',
    llm_provider: 'openai-compatible',
    base_url: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    max_tokens: 2048,
    context_window: 65536,
    // v6.4: per-agent api_key（nullable；回退到 env LLM_API_KEY）。
    api_key: null,
    enabled_api: 0,
    system_prompt: '',
    capabilities: '[]',
    created_at: '2026-06-10T00:00:00.000Z',
    updated_at: '2026-06-10T00:00:00.000Z',
    ...overrides,
  });

  it('insert + get + list', () => {
    dao.insert(sample());
    const got = dao.get('a-1');
    expect(got?.name).toBe('Echo');
    expect(got?.context_window).toBe(65536);
    expect(dao.list()).toHaveLength(1);
  });

  it('get 不存在返回 null', () => {
    expect(dao.get('nope')).toBeNull();
  });

  it('name 重复 insert 抛错（UNIQUE 冲突）', () => {
    dao.insert(sample());
    expect(() => dao.insert(sample({ id: 'a-2' }))).toThrow();
  });

  it('update 修改字段', () => {
    dao.insert(sample());
    dao.update('a-1', {
      name: 'NewName',
      description: 'updated',
      updated_at: '2026-06-10T01:00:00.000Z',
    });
    const got = dao.get('a-1');
    expect(got?.name).toBe('NewName');
    expect(got?.description).toBe('updated');
  });

  it('update 修改 context_window', () => {
    dao.insert(sample());
    dao.update('a-1', {
      context_window: 131072,
      updated_at: '2026-06-10T01:00:00.000Z',
    });
    expect(dao.get('a-1')?.context_window).toBe(131072);
  });

  it('context_window 允许为 null（云端模型不传时）', () => {
    dao.insert(sample({ context_window: null }));
    expect(dao.get('a-1')?.context_window).toBeNull();
  });

  it('v6.4: api_key 落表 + 读回', () => {
    dao.insert(sample({ api_key: 'sk-test-abc' }));
    expect(dao.get('a-1')?.api_key).toBe('sk-test-abc');
  });

  it('v6.4: api_key 允许为 null（回退到 env）', () => {
    dao.insert(sample({ api_key: null }));
    expect(dao.get('a-1')?.api_key).toBeNull();
  });

  it('v6.4: update api_key → 持久化', () => {
    dao.insert(sample());
    dao.update('a-1', {
      api_key: 'sk-updated',
      updated_at: '2026-06-10T01:00:00.000Z',
    });
    expect(dao.get('a-1')?.api_key).toBe('sk-updated');
  });

  it('delete 删行', () => {
    dao.insert(sample());
    dao.delete('a-1');
    expect(dao.get('a-1')).toBeNull();
  });
});
