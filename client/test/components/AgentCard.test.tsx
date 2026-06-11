// AgentCard 组件测试：渲染 + 3 回调（onChat / onEdit / onDelete）+ 冒泡隔离。
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentCard } from '@/components/AgentCard.js';
import type { Agent } from '@/lib/types.js';

const agent: Agent = {
  id: 'a1',
  name: 'Echo',
  description: '默认测试',
  llmProvider: 'openai-compatible',
  baseUrl: 'http://x',
  model: 'qwen',
  maxTokens: null,
  contextWindow: null,
  enabledApi: false,
  systemPrompt: '',
  capabilities: ['chat', 'tool'],
  createdAt: 't',
  updatedAt: 't',
};

describe('<AgentCard>', () => {
  it('渲染 name / description / capabilities chips', () => {
    render(<AgentCard agent={agent} onChat={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Echo')).toBeInTheDocument();
    expect(screen.getByText('默认测试')).toBeInTheDocument();
    expect(screen.getByText('chat')).toBeInTheDocument();
    expect(screen.getByText('tool')).toBeInTheDocument();
  });

  it('点卡片主体 → onChat', () => {
    const onChat = vi.fn();
    render(<AgentCard agent={agent} onChat={onChat} onEdit={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText('Echo'));
    expect(onChat).toHaveBeenCalledTimes(1);
  });

  it('点编辑按钮 → onEdit (不调 onChat)', () => {
    const onChat = vi.fn();
    const onEdit = vi.fn();
    render(<AgentCard agent={agent} onChat={onChat} onEdit={onEdit} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('✎ 编辑'));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onChat).not.toHaveBeenCalled();
  });

  it('点删除按钮 → onDelete (不调 onChat)', () => {
    const onChat = vi.fn();
    const onDelete = vi.fn();
    render(<AgentCard agent={agent} onChat={onChat} onEdit={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByLabelText('⌫ 删除'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onChat).not.toHaveBeenCalled();
  });

  it('description 超 1 行截断（CSS 处理；测试只验 description 出现）', () => {
    const longAgent = { ...agent, description: 'a'.repeat(200) };
    render(<AgentCard agent={longAgent} onChat={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('a'.repeat(200))).toBeInTheDocument();
  });
});
