// 从 .compat.generated.json 读取并校验 compat slice。
// 启动时由 server.ts 调用；找不到或格式错误时抛错（loud fail）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

export type Compat = {
  version: string;
  upstream: Record<string, string>;
};

/**
 * 解析单个 compat JSON 文件并校验：
 * - version 必须是合法 semver
 * - upstream 各项 range 必须是合法 semver range
 * 校验失败抛错（启动 fail-fast）。
 */
export function parseCompat(filePath: string): Compat {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new Error(
      `读取 ${filePath} 失败: ${(e as Error).message}（请先跑 prebuild 同步 compat）`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`解析 ${filePath} 失败: 不是合法 JSON`);
  }
  const compat = parsed as Partial<Compat>;
  if (!semver.valid(compat.version ?? '')) {
    throw new Error(`${filePath} 的 version "${compat.version}" 不是合法 semver`);
  }
  for (const [up, range] of Object.entries(compat.upstream ?? {})) {
    if (!semver.validRange(range)) {
      throw new Error(`${filePath} 的 upstream.${up} range "${range}" 不是合法 semver range`);
    }
  }
  return compat as Compat;
}

/**
 * 在当前子项目根目录下找 .compat.generated.json 并解析。
 * 文件名按惯例：{subprojectName}/.compat.generated.json
 * subprojectName 由调用方传入（仅作 future-proof API 形参，不参与路径拼接）。
 *
 * 实现要点：用 import.meta.url 锚定路径，与 sync-compat.mjs 同风格，
 * 从子项目 cwd 或 repo root 跑都能找到正确文件。
 */
export function loadCompat(subprojectName: string): Compat {
  // 假设调用方传 'core' 或 'gateway'，slice 位于 {name}/.compat.generated.json。
  // 当前模块位于 {name}/src/compat/load.ts（dev: tsx 直跑 .ts），
  // 或 {name}/dist/compat/load.js（prod: tsc 编译后）。
  // 两种情况下 '../../.compat.generated.json' 都解析到 {name}/.compat.generated.json。
  // 注：subprojectName 当前不参与路径拼接（仅保留为 future-proof API 形参），
  // 与 sync-compat.mjs 写出的位置保持一致。
  void subprojectName; // 显式标记未使用，避免 lint warning
  const target = fileURLToPath(new URL(`../../.compat.generated.json`, import.meta.url));
  return parseCompat(target);
}
