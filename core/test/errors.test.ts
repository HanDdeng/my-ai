import { describe, it, expect } from 'vitest';
import { HttpError } from '@/errors.js';

describe('HttpError', () => {
  it('携带 status 与 code', () => {
    const e = new HttpError(404, 'agent_not_found');
    expect(e.status).toBe(404);
    expect(e.code).toBe('agent_not_found');
    expect(e.message).toBe('agent_not_found');
    expect(e.name).toBe('HttpError');
  });

  it('instanceof Error', () => {
    const e = new HttpError(500, 'internal_error');
    expect(e).toBeInstanceOf(Error);
  });
});
