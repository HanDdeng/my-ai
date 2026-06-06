import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCompat, type Compat } from './load.js';

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'load-compat-'));
});
afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe('parseCompat', () => {
  it('合法 JSON → 解析为 Compat 对象', () => {
    const sample: Compat = { version: '2.0.0', upstream: { core: '>=2.0.0' } };
    const tmpFile = join(workdir, 'sample.json');
    writeFileSync(tmpFile, JSON.stringify(sample));
    expect(parseCompat(tmpFile)).toEqual(sample);
  });

  it('JSON 非法 → 抛错', () => {
    const tmpFile = join(workdir, 'bad.json');
    writeFileSync(tmpFile, '{not json');
    expect(() => parseCompat(tmpFile)).toThrow();
  });

  it('version 字段不是合法 semver → 抛错', () => {
    const tmpFile = join(workdir, 'bad-version.json');
    writeFileSync(tmpFile, JSON.stringify({ version: 'not-semver', upstream: {} }));
    expect(() => parseCompat(tmpFile)).toThrow(/semver/);
  });

  it('upstream 中某 range 不合法 → 抛错', () => {
    const tmpFile = join(workdir, 'bad-range.json');
    writeFileSync(tmpFile, JSON.stringify({ version: '2.0.0', upstream: { x: 'bad' } }));
    expect(() => parseCompat(tmpFile)).toThrow(/semver/);
  });
});
