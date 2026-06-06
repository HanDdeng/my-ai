#!/usr/bin/env node
// 从 versions/compat-matrix.json 切出各端 slice，build-time 同步。
// - gateway / core → 写 .compat.generated.json（运行时 fs.readFileSync 读）
// - client          → 写 src/compat.generated.ts（编译时 import）
//
// 由各子项目 predev / prebuild 钩子触发；dev 期间改了 matrix 也立即生效。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const MATRIX_PATH = 'versions/compat-matrix.json';

function readMatrix() {
  let raw;
  try {
    raw = readFileSync(MATRIX_PATH, 'utf8');
  } catch (e) {
    throw new Error(`读取 ${MATRIX_PATH} 失败: ${e.message}`);
  }
  const matrix = JSON.parse(raw);
  if (matrix.schema !== 1) {
    throw new Error(`不支持的 compat-matrix schema: ${matrix.schema}（当前仅支持 1）`);
  }
  return matrix;
}

/**
 * 把单端 slice 写到目标路径。返回写入的相对路径。
 */
function writeSlice(name, slice) {
  if (name === 'client') {
    const dst = resolve('client/src/compat.generated.ts');
    mkdirSync(dirname(dst), { recursive: true });
    const body = [
      '// 自动生成，请勿手改（predev / prebuild 钩子覆盖）',
      '// 来源：versions/compat-matrix.json',
      `export const COMPAT = ${JSON.stringify(slice, null, 2)} as const;`,
      '',
    ].join('\n');
    writeFileSync(dst, body);
    return 'client/src/compat.generated.ts';
  }
  const dst = resolve(name, '.compat.generated.json');
  writeFileSync(dst, JSON.stringify(slice, null, 2) + '\n');
  return `${name}/.compat.generated.json`;
}

export function syncAll() {
  const matrix = readMatrix();
  const { components, compat } = matrix;
  const written = [];
  for (const [name, info] of Object.entries(components)) {
    const slice = {
      version: info.version,
      upstream: compat[name] ?? {},
    };
    written.push(writeSlice(name, slice));
  }
  return written;
}

// CLI 入口
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  try {
    const written = syncAll();
    for (const p of written) {
      console.log(`✓ ${p}`);
    }
  } catch (e) {
    console.error(`✖ ${e.message}`);
    process.exit(1);
  }
}
