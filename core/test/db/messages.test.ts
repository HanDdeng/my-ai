import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@/db/index.js';
import { AgentsDAO, type AgentRow } from '@/db/agents.js';
import { SessionsDAO, type SessionRow } from '@/db/sessions.js';
import { MessagesDAO, type MessageRow } from '@/db/messages.js';

describe('MessagesDAO', () => {
  let dir: string;
  let messages: MessagesDAO;
  let sessions: SessionsDAO;
  let agents: AgentsDAO;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'core-msgs-'));
    const db = openDatabase(join(dir, 'core.db'));
    messages = new MessagesDAO(db);
    sessions = new SessionsDAO(db);
    agents = new AgentsDAO(db);
    agents.insert({
      id: 'a-1',
      name: 'Echo',
      description: '',
      llm_provider: 'openai-compatible',
      base_url: 'http://localhost:11434/v1',
      model: 'qwen2.5:7b',
      max_tokens: null,
      enabled_api: 0,
      system_prompt: '',
      capabilities: '[]',
      created_at: '2026-06-10T00:00:00.000Z',
      updated_at: '2026-06-10T00:00:00.000Z',
    } satisfies AgentRow);
    sessions.insert({
      id: 's-1',
      agent_id: 'a-1',
      client_key: 'ck',
      title: '',
      created_at: '2026-06-10T00:00:00.000Z',
      updated_at: '2026-06-10T00:00:00.000Z',
    } satisfies SessionRow);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const sample = (overrides: Partial<MessageRow> = {}): MessageRow => ({
    id: 'm-1',
    session_id: 's-1',
    role: 'user',
    content: 'hi',
    created_at: '2026-06-10T00:00:00.000Z',
    ...overrides,
  });

  it('insert + get + listBySession 按 id 字典序', () => {
    // UUID v4 hex 固定宽度 → 字典序正确。
    // 真实 client 会用 randomUUID()，其 hex 形式可字典序排序。
    // 这里用 3 个确定性 UUID 测试；时间戳部分递增保证 id 字典序与插入顺序一致。
    const id1 = '01900000-0000-4000-8000-000000000001'; // 早
    const id2 = '01900000-0000-4000-8000-000000000002'; // 中
    const id3 = '01900000-0000-4000-8000-000000000010'; // 晚
    messages.insert(sample({ id: id2, role: 'assistant', content: 'hello' }));
    messages.insert(sample({ id: id1 }));
    messages.insert(sample({ id: id3, role: 'assistant', content: 'ten' }));

    const list = messages.listBySession('s-1');
    expect(list.map(m => m.id)).toEqual([id1, id2, id3]);
  });

  it('listBySession 空 session 返回空数组', () => {
    expect(messages.listBySession('s-empty')).toEqual([]);
  });

  it('删 session CASCADE 删 messages', () => {
    messages.insert(sample());
    sessions.delete('s-1');
    expect(messages.listBySession('s-1')).toEqual([]);
  });
});
