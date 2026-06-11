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
    // v6.3.2: 新增 reasoning_effort（OpenAI o1/o3 思考强度；其他 provider 静默忽略）。
    reasoning_effort: 'none',
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

  it('v6.3.2: reasoning_effort 落表 + 读回', () => {
    dao.insert(sample({ reasoning_effort: 'high' }));
    expect(dao.get('a-1')?.reasoning_effort).toBe('high');
  });

  it('v6.3.2: reasoning_effort 允许为 null（schema 允许）', () => {
    dao.insert(sample({ reasoning_effort: null }));
    expect(dao.get('a-1')?.reasoning_effort).toBeNull();
  });

  it('v6.3.2: update reasoning_effort → 持久化', () => {
    dao.insert(sample());
    dao.update('a-1', {
      reasoning_effort: 'medium',
      updated_at: '2026-06-10T01:00:00.000Z',
    });
    expect(dao.get('a-1')?.reasoning_effort).toBe('medium');
  });

  it('v6.3.2: reasoning_effort 越界值（不是 6 选项之一） → 抛 CHECK 约束错', () => {
    // 走 prepared.stmt，绕过 zod；DB 仍会拒。
    expect(() => dao.insert(sample({ reasoning_effort: 'bogus' as never }))).toThrow();
  });

  it('delete 删行', () => {
    dao.insert(sample());
    dao.delete('a-1');
    expect(dao.get('a-1')).toBeNull();
  });
});
