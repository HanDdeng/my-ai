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
 * 在当前进程的 dist/.. 路径下找 .compat.generated.json 并解析。
 * 文件名按惯例：{subprojectName}/.compat.generated.json
 * subprojectName 由调用方传入。
 *
 * 实现要点：用 import.meta.url 锚定路径，与 sync-compat.mjs 同风格，
 * 从子项目 cwd 或 repo root 跑都能找到正确文件。
 */
export function loadCompat(subprojectName: string): Compat {
  // core/src/compat/load.ts（dist 后是 core/dist/compat/load.js）
  // 上 3 级到 core/，再拼 {name}.compat.generated.json
  const target = fileURLToPath(
    new URL(`../../${subprojectName}.compat.generated.json`, import.meta.url),
  );
  return parseCompat(target);
}
