// 验证 sync-versions.mjs 在临时 workdir 里能正确更新 4 个文件。
// 模式与 scripts/sync-compat.test.mjs 一致：建 workdir、写 matrix、复制脚本、跑。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SCRIPT_SRC = join(process.cwd(), 'scripts/sync-versions.mjs');

const baseMatrix = {
  schema: 1,
  components: {
    client: { version: '0.5.0' },
    gateway: { version: '0.4.0' },
    core: { version: '0.4.0' },
  },
  compat: { client: {}, gateway: {}, core: {} },
};

// 最小可用的 package.json 模板（含 name / version 两个字段即满足脚本读写）
function makePkgJson(name) {
  return JSON.stringify({ name: `@my-ai/${name}`, version: '0.0.1' }, null, 2) + '\n';
}

describe('sync-versions.mjs', () => {
  let workdir;
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'sync-versions-'));
  });
  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  function setupAndRun(matrix) {
    for (const d of ['scripts', 'client/src-tauri', 'gateway', 'core', 'versions']) {
      execFileSync('mkdir', ['-p', join(workdir, d)]);
    }
    writeFileSync(join(workdir, 'versions/compat-matrix.json'), JSON.stringify(matrix));
    // 预置 4 个 version 字段文件，初始值故意与 matrix 不同
    writeFileSync(join(workdir, 'client/package.json'), makePkgJson('client'));
    writeFileSync(join(workdir, 'client/src-tauri/tauri.conf.json'), makePkgJson('client-tauri'));
    writeFileSync(join(workdir, 'gateway/package.json'), makePkgJson('gateway'));
    writeFileSync(join(workdir, 'core/package.json'), makePkgJson('core'));
    copyFileSync(SCRIPT_SRC, join(workdir, 'scripts/sync-versions.mjs'));
    execFileSync('node', ['scripts/sync-versions.mjs'], { cwd: workdir });
  }

  it('client 的 2 个文件都更新到 0.5.0', () => {
    setupAndRun(baseMatrix);
    const pkg = JSON.parse(readFileSync(join(workdir, 'client/package.json'), 'utf8'));
    const tauri = JSON.parse(
      readFileSync(join(workdir, 'client/src-tauri/tauri.conf.json'), 'utf8'),
    );
    expect(pkg.version).toBe('0.5.0');
    expect(tauri.version).toBe('0.5.0');
  });

  it('gateway 写到 0.4.0', () => {
    setupAndRun(baseMatrix);
    const pkg = JSON.parse(readFileSync(join(workdir, 'gateway/package.json'), 'utf8'));
    expect(pkg.version).toBe('0.4.0');
  });

  it('core 写到 0.4.0', () => {
    setupAndRun(baseMatrix);
    const pkg = JSON.parse(readFileSync(join(workdir, 'core/package.json'), 'utf8'));
    expect(pkg.version).toBe('0.4.0');
  });

  it('保留其他字段（name 等不动）', () => {
    setupAndRun(baseMatrix);
    const pkg = JSON.parse(readFileSync(join(workdir, 'client/package.json'), 'utf8'));
    expect(pkg.name).toBe('@my-ai/client');
  });

  it('值已一致时输出 = 不重写', () => {
    for (const d of ['scripts', 'client/src-tauri', 'gateway', 'core', 'versions']) {
      execFileSync('mkdir', ['-p', join(workdir, d)]);
    }
    writeFileSync(join(workdir, 'versions/compat-matrix.json'), JSON.stringify(baseMatrix));
    // 预置 4 个文件 version=0.5.0/0.4.0/0.4.0，与 matrix 完全相同
    writeFileSync(
      join(workdir, 'client/package.json'),
      JSON.stringify({ name: 'x', version: '0.5.0' }) + '\n',
    );
    writeFileSync(
      join(workdir, 'client/src-tauri/tauri.conf.json'),
      JSON.stringify({ name: 'x', version: '0.5.0' }) + '\n',
    );
    writeFileSync(
      join(workdir, 'gateway/package.json'),
      JSON.stringify({ name: 'x', version: '0.4.0' }) + '\n',
    );
    writeFileSync(
      join(workdir, 'core/package.json'),
      JSON.stringify({ name: 'x', version: '0.4.0' }) + '\n',
    );
    copyFileSync(SCRIPT_SRC, join(workdir, 'scripts/sync-versions.mjs'));
    // 跑脚本不应抛错，且文件内容不变（关键：检测文件是否被改）
    const before = readFileSync(join(workdir, 'client/package.json'), 'utf8');
    execFileSync('node', ['scripts/sync-versions.mjs'], { cwd: workdir });
    const after = readFileSync(join(workdir, 'client/package.json'), 'utf8');
    expect(after).toBe(before);
  });

  it('schema 不是 1 → 进程退出 1', () => {
    const bad = structuredClone(baseMatrix);
    bad.schema = 2;
    for (const d of ['scripts', 'client/src-tauri', 'gateway', 'core', 'versions']) {
      execFileSync('mkdir', ['-p', join(workdir, d)]);
    }
    // 预置 4 个文件，避免 updateVersion 路径异常
    writeFileSync(join(workdir, 'client/package.json'), makePkgJson('client'));
    writeFileSync(join(workdir, 'client/src-tauri/tauri.conf.json'), makePkgJson('client'));
    writeFileSync(join(workdir, 'gateway/package.json'), makePkgJson('gateway'));
    writeFileSync(join(workdir, 'core/package.json'), makePkgJson('core'));
    writeFileSync(join(workdir, 'versions/compat-matrix.json'), JSON.stringify(bad));
    copyFileSync(SCRIPT_SRC, join(workdir, 'scripts/sync-versions.mjs'));
    expect(() => execFileSync('node', ['scripts/sync-versions.mjs'], { cwd: workdir })).toThrow();
  });
});
