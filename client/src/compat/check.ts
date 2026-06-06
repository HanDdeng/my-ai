// 镜像自 core/src/compat/check.ts，保持一致。
// canonical 版本在 core；修改请同步。
import semver from 'semver';

/**
 * 判断 got（上游版本）是否满足 want（下游声明的范围）。
 * 任一参数非法时返回 false（保守路径：无法确认即视为不兼容）。
 * pre-release 视为其 base 版本参与比较（2.0.0-rc.1 → 2.0.0）：
 * pre-release 仍视作同一 minor 系列的一部分，base 落在范围内即算兼容。
 * 这一点比 semver 默认行为更宽松：semver 的 satisfies 不会让
 * "2.0.0-rc.1" 通过 ">=2.0.0" 这种纯 stable range。
 */
export function checkCompat(got: string, want: string): boolean {
  if (!got || !want || !semver.valid(got) || !semver.validRange(want)) {
    return false;
  }
  // 用 coerce 抽出 base（剥掉 prerelease / build），让 satisfies 跑在 stable 上。
  const base = semver.coerce(got)?.version ?? got;
  return semver.satisfies(base, want, { includePrerelease: true });
}
