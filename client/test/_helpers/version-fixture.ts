// 从 semver range 派生测试用的 mock gateway 版本号。
// 目的：避免在测试里硬编码版本号——matrix 改 range 时只动 matrix.json，测试 0 改动。
//
// 选版本策略：
// - pickInRange(range): 从候选池（升序）里挑第一个满足 range 的——贴近 range 下界的"最小合法版本"
// - pickOutOfRange(range): 从候选池（降序）里挑第一个不满足 range 的——若 range 有上界则挑超过上界，
//   若只有下界（如 >=0.0.4）则挑低于下界的版本
//
// 候选池覆盖常见 release 路径（0.0.x 补丁 → 0.x minor → 1.x+ major）。
// 任何 range 至少会命中一个候选；否则视为 matrix 配置错误。
import semver from 'semver';

const CANDIDATES = [
  '0.0.0',
  '0.0.1',
  '0.0.2',
  '0.0.3',
  '0.0.4',
  '0.0.5',
  '0.0.6',
  '0.0.7',
  '0.0.8',
  '0.0.9',
  '0.1.0',
  '0.2.0',
  '0.5.0',
  '1.0.0',
  '2.0.0',
  '9.9.9',
] as const;

export function pickInRange(range: string): string {
  for (const v of CANDIDATES) {
    if (semver.satisfies(v, range, { includePrerelease: true })) {
      return v;
    }
  }
  throw new Error(`version-fixture: 候选池中没有满足 range "${range}" 的版本（matrix 配置错误？）`);
}

export function pickOutOfRange(range: string): string {
  for (const v of [...CANDIDATES].reverse()) {
    if (!semver.satisfies(v, range, { includePrerelease: true })) {
      return v;
    }
  }
  throw new Error(`version-fixture: 候选池全部满足 range "${range}"，无 out-of-range 可选`);
}

/** 把 semver 版本号里的 `.` 转义给 RegExp 用。 */
export function escapeVersionForRegex(version: string): string {
  return version.replace(/\./g, '\\.');
}
