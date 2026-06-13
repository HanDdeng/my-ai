#!/usr/bin/env node
// 从 versions/compat-matrix.json 读 components.{client,gateway,core}.version，
// 写进 4 个真实的 version 字段文件，保持 matrix 为 single source of truth。
//
// 目标映射：
//   client  → client/package.json + client/src-tauri/tauri.conf.json
//   gateway → gateway/package.json
//   core    → core/package.json
//
// **手动执行命令**。不接入 predev / prebuild 钩子，不接入 CI。
// 设计原因：package.json 的 version 字段是 npm pack / tauri bundle 的真实来源，
// 改它会真的改打包产物。开发者改 matrix 时必须有意识地跑一次 sync。
//
// 用法：pnpm run sync:versions
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MATRIX_PATH = fileURLToPath(new URL('../versions/compat-matrix.json', import.meta.url));

const TARGETS = {
  client: ['client/package.json', 'client/src-tauri/tauri.conf.json'],
  gateway: ['gateway/package.json'],
  core: ['core/package.json'],
};

function readMatrix() {
  const raw = readFileSync(MATRIX_PATH, 'utf8');
  const matrix = JSON.parse(raw);
  if (matrix.schema !== 1) {
    throw new Error(`不支持的 compat-matrix schema: ${matrix.schema}（当前仅支持 1）`);
  }
  if (!matrix.components || typeof matrix.components !== 'object') {
    throw new Error('matrix 缺 components 字段');
  }
  return matrix;
}

function updateVersion(relPath, version) {
  const absPath = fileURLToPath(new URL(`../${relPath}`, import.meta.url));
  const data = JSON.parse(readFileSync(absPath, 'utf8'));
  if (data.version === version) {
    return { relPath, changed: false, version };
  }
  const from = data.version;
  data.version = version;
  // 2 空格缩进 + 末尾换行，与 .prettierrc.json 保持一致；prettier --write 不会 normalize 差异。
  writeFileSync(absPath, JSON.stringify(data, null, 2) + '\n');
  return { relPath, changed: true, from, to: version };
}

export function syncAll() {
  const matrix = readMatrix();
  const results = [];
  for (const [name, files] of Object.entries(TARGETS)) {
    const info = matrix.components[name];
    if (!info || typeof info.version !== 'string') {
      throw new Error(`matrix 缺 components.${name}.version`);
    }
    for (const f of files) {
      results.push(updateVersion(f, info.version));
    }
  }
  return results;
}

const isMain = (() => {
  try {
    const modulePath = fileURLToPath(import.meta.url);
    const argvPath = resolve(process.argv[1]);
    return modulePath === argvPath;
  } catch {
    return false;
  }
})();
if (isMain) {
  try {
    const results = syncAll();
    for (const r of results) {
      if (r.changed) {
        console.log(`✓ ${r.relPath}: ${r.from} → ${r.to}`);
      } else {
        console.log(`= ${r.relPath}: already ${r.version}`);
      }
    }
  } catch (e) {
    console.error(`✖ ${e.message}`);
    process.exit(1);
  }
}
