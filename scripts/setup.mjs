#!/usr/bin/env node
// 跨平台 bootstrap：clone 后跑 `pnpm setup` 自动把 .env.example 复制成 .env。
// Node 自带 fs，无需额外依赖；macOS / Linux / Windows (含 Git Bash / PowerShell) 都能跑。

import { copyFile, access, constants } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 仓库根 = scripts 目录的父级。
const root = resolve(__dirname, '..');

const pairs = [
  { src: 'gateway/.env.example', dst: 'gateway/.env' },
  { src: 'core/.env.example', dst: 'core/.env' },
];

let copied = 0;
let skipped = 0;

for (const { src, dst } of pairs) {
  const srcPath = resolve(root, src);
  const dstPath = resolve(root, dst);

  // src 必须存在；这里只 sanity check 一下。
  if (!existsSync(srcPath)) {
    console.error(`✖ 找不到模板 ${src}`);
    process.exit(1);
  }

  // dst 已存在则跳过，避免覆盖开发者的本地配置。
  try {
    await access(dstPath, constants.F_OK);
    console.log(`↷ 跳过 ${dst}（已存在）`);
    skipped += 1;
    continue;
  } catch {
    // 不存在，复制。
  }

  await copyFile(srcPath, dstPath);
  console.log(`✓ 已生成 ${dst}（请按需修改）`);
  copied += 1;
}

console.log('');
console.log(`完成：${copied} 新建 / ${skipped} 跳过`);
console.log('');
console.log('下一步：');
console.log('  1. 检查并按需修改 gateway/.env 和 core/.env');
console.log('  2. pnpm install');
console.log('  3. pnpm dev   （三服务并行启动）');
console.log('');
console.log('如需重置：rm gateway/.env core/.env && pnpm setup');
