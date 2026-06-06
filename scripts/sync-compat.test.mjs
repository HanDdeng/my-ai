import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SCRIPT_SRC = join(process.cwd(), 'scripts/sync-compat.mjs');

const baseMatrix = {
  schema: 1,
  components: {
    client: { version: '2.0.0' },
    gateway: { version: '2.0.0' },
    core: { version: '2.0.0' },
  },
  compat: {
    client: { gateway: '>=2.0.0 <3.0.0' },
    gateway: { core: '>=2.0.0 <3.0.0' },
    core: {},
  },
};

describe('sync-compat.mjs', () => {
  let workdir;
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'sync-compat-'));
  });
  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  /**
   * 在临时 workdir 下构造最小项目结构（scripts/、gateway/、core/、client/src/、versions/），
   * 把仓库根的 sync-compat.mjs 复制到 workdir/scripts/，写入指定 matrix，跑脚本。
   * 复制到 scripts/ 下是为了与生产布局一致，让 import.meta.url 解析的 matrix 路径
   * 落在 workdir/versions/compat-matrix.json。
   */
  function setupAndRun(matrix) {
    for (const d of ['scripts', 'gateway', 'core', 'client/src', 'versions']) {
      execFileSync('mkdir', ['-p', join(workdir, d)]);
    }
    writeFileSync(join(workdir, 'versions/compat-matrix.json'), JSON.stringify(matrix));
    copyFileSync(SCRIPT_SRC, join(workdir, 'scripts/sync-compat.mjs'));
    execFileSync('node', ['scripts/sync-compat.mjs'], { cwd: workdir });
    return workdir;
  }

  it('正确写出 gateway / core 的 .compat.generated.json', () => {
    setupAndRun(baseMatrix);

    const gw = JSON.parse(readFileSync(join(workdir, 'gateway/.compat.generated.json'), 'utf8'));
    expect(gw).toEqual({ version: '2.0.0', upstream: { core: '>=2.0.0 <3.0.0' } });

    const co = JSON.parse(readFileSync(join(workdir, 'core/.compat.generated.json'), 'utf8'));
    expect(co).toEqual({ version: '2.0.0', upstream: {} });
  });

  it('正确写出 client 的 compat.generated.ts（TS 注入）', () => {
    setupAndRun(baseMatrix);

    const ts = readFileSync(join(workdir, 'client/src/compat.generated.ts'), 'utf8');
    expect(ts).toContain('export const COMPAT');
    expect(ts).toContain('"version": "2.0.0"');
    expect(ts).toContain('"gateway": ">=2.0.0 <3.0.0"');
  });

  it('schema 不是 1 → 进程退出 1', () => {
    const badMatrix = structuredClone(baseMatrix);
    badMatrix.schema = 2;
    expect(() => setupAndRun(badMatrix)).toThrow();
  });

  it('缺 compat 字段 → 该端 upstream 为空对象', () => {
    const partialMatrix = structuredClone(baseMatrix);
    delete partialMatrix.compat.core;
    setupAndRun(partialMatrix);

    const co = JSON.parse(readFileSync(join(workdir, 'core/.compat.generated.json'), 'utf8'));
    expect(co).toEqual({ version: '2.0.0', upstream: {} });
  });
});
