#!/usr/bin/env bash
# 从 versions/compat-matrix.json + 上次 release 以来 diff 渲染 release body。
# 输出 markdown 到 stdout。调用方负责重定向到文件。
set -uo pipefail

MATRIX="versions/compat-matrix.json"
LAST_TAG="${1:-}"

if [ ! -f "$MATRIX" ]; then
  echo "✖ 缺 $MATRIX"; exit 1
fi

# 解析 matrix 字段（用 node，避免 jq 依赖）
read_version() {
  node -e "const m=require('./$MATRIX'); console.log(m.components['$1'].version)"
}
read_range() {
  node -e "const m=require('./$MATRIX'); console.log((m.compat['$1']||{})['$2']||'-')"
}

CLIENT_VER=$(read_version client)
GW_VER=$(read_version gateway)
CORE_VER=$(read_version core)
CLIENT_GW_RANGE=$(read_range client gateway)
GW_CORE_RANGE=$(read_range gateway core)

DATE=$(date +%Y-%m-%d)
SHORT_SHA="${GITHUB_SHA:-$(git rev-parse --short HEAD)}"

cat <<EOF
## my-ai release-${DATE//-/}-${SHORT_SHA} (${DATE})

### 子项目版本
- client  : ${CLIENT_VER}
- gateway : ${GW_VER}
- core    : ${CORE_VER}

### 兼容矩阵
| 下游    | 上游    | 接受范围        |
| ------- | ------- | --------------- |
| client  | gateway | ${CLIENT_GW_RANGE} |
| gateway | core    | ${GW_CORE_RANGE}    |
| core    | —       | —              |

EOF

# 如果是首次 release（无 last tag），跳过 diff 段
if [ -z "$LAST_TAG" ]; then
  cat <<EOF
### 功能变更
- **client**: （无）
- **gateway**: （无）
- **core**: （无）

### Bug 修复
- **client**: （无）
- **gateway**: （无）
- **core**: （无）

### 兼容性变更
- （首次 release，无 diff 来源）
EOF
  exit 0
fi

# 拿到 last 以来所有 commits，提取 feat:/fix: 开头的
COMMITS=$(git log "$LAST_TAG"..HEAD --pretty=format:"%H %s" 2>/dev/null || true)

# 判定 commit 是否归属指定子项目：
#   client / gateway / core → 动了该子项目根目录
#   工程化                  → 三个子项目都没动（命中 .github/、scripts/、docs/、
#                             versions/、根配置等"非子项目"路径的 commit 都归这里）
matches_sub() {
  local hash="$1"
  local sub="$2"
  if [ "$sub" = "工程化" ]; then
    ! git diff-tree --no-commit-id --name-only -r "$hash" 2>/dev/null \
      | grep -qE "^(client|gateway|core)/"
  else
    git diff-tree --no-commit-id --name-only -r "$hash" 2>/dev/null \
      | grep -q "^$sub/"
  fi
}

# 判定 commit 的所有文件变更是否都已在 base（LAST_TAG）里——是的话视为"重复"，
# 应跳过。两种典型场景：
#   1) DRY-RUN 用 origin/main 作 base：原始 commit 被 squash 合入 main 后，log 里
#      还残留这条 commit 但文件内容已重复。e1add23 (MismatchBanner) 就是这种情况。
#   2) production 用 last release tag 作 base：commit 的所有变更已在 last release
#      里，应被 skip（避免重复展示已 release 的内容）。
# 检查方式：对比每个文件的 blob SHA（不看 commit graph，看 tree 内容）。
# 跳过 test 文件和 lockfile——这两类的 diff 几乎都是机械替换（version 字符串、
# dependency 树），不代表真实 feature 变更；只看 *.ts/*.tsx 等"实质"文件即可。
is_already_in_base() {
  local commit="$1"
  local base_root
  base_root=$(git rev-parse "$LAST_TAG" 2>/dev/null) || return 1
  local files
  files=$(git diff-tree --no-commit-id --name-only -r "$commit" 2>/dev/null)
  if [ -z "$files" ]; then
    return 0  # 没改任何文件（merge commit 等），视为已在 base
  fi
  while IFS= read -r f; do
    # 跳过 test / spec / lockfile——这些是机械 diff 噪声
    case "$f" in
      *.test.*|*.spec.*) continue ;;
      __tests__/*|*/__tests__/*) continue ;;
      pnpm-lock.yaml|package-lock.json|yarn.lock) continue ;;
    esac
    local base_blob commit_blob
    base_blob=$(git ls-tree "$base_root" "$f" 2>/dev/null | awk '{print $3}')
    commit_blob=$(git ls-tree "$commit" "$f" 2>/dev/null | awk '{print $3}')
    # base 没有该文件 → 新增文件 → 算新变更
    [ -z "$base_blob" ] && return 1
    # base 里有但 blob 不同 → 文件内容被改 → 算新变更
    [ "$base_blob" != "$commit_blob" ] && return 1
  done <<< "$files"
  return 0  # 全部"实质"文件在 base 里 blob 一致 → 视为已在 base
}

echo "### 功能变更"
for sub in client gateway core 工程化; do
  echo "- **$sub**:"
  feats=$(echo "$COMMITS" | while read -r hash subject; do
    [ -z "$subject" ] && continue
    # 兼容 conventional commit 的 scope：fix(compat) / feat(api) / chore(ci) 等。
    # 只取首个 `:` 前的 token，再去掉可能的 `(...)` 部分，留下纯 type。
    # 之前只支持无 scope 的 `fix: ...` / `feat: ...`，本仓库大量用 `fix(compat):`
    # 这种 scoped 形式，导致这部分 commit 整段被静默丢弃。
    type="${subject%%:*}"
    type="${type%%(*}"
    rest="${subject#*: }"
    if [ "$type" = "feat" ] && ! is_already_in_base "$hash" && matches_sub "$hash" "$sub"; then
      echo "  - feat: $rest"
    fi
  done)
  if [ -z "$feats" ]; then
    echo "  - （无）"
  else
    echo "$feats"
  fi
done

echo ""
echo "### Bug 修复"
for sub in client gateway core 工程化; do
  echo "- **$sub**:"
  fixes=$(echo "$COMMITS" | while read -r hash subject; do
    [ -z "$subject" ] && continue
    type="${subject%%:*}"
    type="${type%%(*}"
    rest="${subject#*: }"
    if [ "$type" = "fix" ] && ! is_already_in_base "$hash" && matches_sub "$hash" "$sub"; then
      echo "  - fix: $rest"
    fi
  done)
  if [ -z "$fixes" ]; then
    echo "  - （无）"
  else
    echo "$fixes"
  fi
done

echo ""
echo "### 兼容性变更"
compat_changed=$(git log "$LAST_TAG"..HEAD --pretty=format:"" -- versions/compat-matrix.json | wc -l)
if [ "$compat_changed" -gt 0 ]; then
  echo "- versions/compat-matrix.json 在此次 release 中有变更（详见 git diff）"
else
  echo "- （无）"
fi
