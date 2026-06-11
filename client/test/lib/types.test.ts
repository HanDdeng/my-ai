// client/src/lib/types 形状测试：编译时 + 运行时双重验证。
// 11 字段 Agent / 6 字段 Session / 6 字段 Message + 4 Request/Response Body。
// 这是纯类型模块，无运行时行为；测试通过 = 字段名 / 类型与 v6.1 core 端契约一致。
import { describe, it, expect } from 'vitest';
import type {
  Agent,
  Session,
  Message,
  CreateAgentBody,
  UpdateAgentBody,
  CreateSessionBody,
  PostMessageBody,
  PostMessageResponse,
} from '@/lib/types.js';

describe('client/src/lib/types', () => {
  it('Agent 形状：13 字段（含 capabilities 数组 + v6.3.1 contextWindow）', () => {
    const a: Agent = {
      id: 'a1',
      name: 'Echo',
      description: '',
      llmProvider: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen2.5:7b',
      maxTokens: null,
      // v6.3.1: 新增 contextWindow（云端模型需要区分 per-response maxTokens 与总 context window）
      contextWindow: null,
      enabledApi: false,
      systemPrompt: '',
      capabilities: ['chat', 'tool'],
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
    };
    expect(Object.keys(a)).toHaveLength(13);
    expect(a.llmProvider).toBe('openai-compatible');
  });

  it('Session 形状：6 字段', () => {
    const s: Session = {
      id: 's1',
      agentId: 'a1',
      clientKey: 'sha256-hash-abc',
      title: '',
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
    };
    expect(s.agentId).toBe('a1');
  });

  it('Message 形状：5 字段 + role 联合类型', () => {
    const m: Message = {
      id: 'm1',
      sessionId: 's1',
      role: 'user',
      content: 'hi',
      createdAt: '2026-06-11T00:00:00.000Z',
    };
    expect(m.role).toBe('user');
  });

  it('CreateAgentBody 排除 id / createdAt / updatedAt（client 生成）', () => {
    const b: CreateAgentBody = {
      name: 'Echo',
      description: '',
      llmProvider: 'openai-compatible',
      baseUrl: 'http://x',
      model: 'qwen',
      maxTokens: null,
      // v6.3.1: 新增 contextWindow
      contextWindow: null,
      enabledApi: false,
      systemPrompt: '',
      capabilities: [],
    };
    // @ts-expect-error id 字段不在 CreateAgentBody
    void b.id;
  });

  it('UpdateAgentBody 排除 id / llmProvider / createdAt / updatedAt', () => {
    const b: UpdateAgentBody = { name: 'Renamed' };
    // @ts-expect-error llmProvider 不可改
    void b.llmProvider;
  });

  it('CreateSessionBody 必含 id + agentId', () => {
    const b: CreateSessionBody = { id: 's1', agentId: 'a1' };
    expect(b.id).toBe('s1');
  });

  it('PostMessageBody 必含 id + content', () => {
    const b: PostMessageBody = { id: 'um1', content: 'hello' };
    expect(b.content).toBe('hello');
  });

  it('PostMessageResponse 必含 userMessage + assistantMessage', () => {
    const r: PostMessageResponse = {
      userMessage: { id: 'um1', sessionId: 's1', role: 'user', content: 'hi', createdAt: 't' },
      assistantMessage: {
        id: 'am1',
        sessionId: 's1',
        role: 'assistant',
        content: 'echo',
        createdAt: 't',
      },
    };
    expect(r.userMessage.role).toBe('user');
    expect(r.assistantMessage.role).toBe('assistant');
  });
});
