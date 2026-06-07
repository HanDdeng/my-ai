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

echo "### 功能变更"
for sub in client gateway core; do
  echo "- **$sub**:"
  feats=$(echo "$COMMITS" | while read -r hash subject; do
    [ -z "$subject" ] && continue
    # 简单解析：type: subject 形式
    # 兼容 conventional commit 的 scope：fix(compat) / feat(api) / chore(ci) 等。
    # 只取首个 `:` 前的 token，再去掉可能的 `(...)` 部分，留下纯 type。
    # 之前只支持无 scope 的 `fix: ...` / `feat: ...`，本仓库大量用 `fix(compat):`
    # 这种 scoped 形式，导致这部分 commit 整段被静默丢弃。
    type="${subject%%:*}"
    type="${type%%(*}"
    rest="${subject#*: }"
    if [ "$type" = "feat" ]; then
      # 看 commit 改了哪些 $sub 路径
      if git diff-tree --no-commit-id --name-only -r "$hash" 2>/dev/null | grep -q "^$sub/"; then
        echo "  - feat: $rest"
      fi
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
for sub in client gateway core; do
  echo "- **$sub**:"
  fixes=$(echo "$COMMITS" | while read -r hash subject; do
    [ -z "$subject" ] && continue
    # 兼容 conventional commit 的 scope：fix(compat) / feat(api) / chore(ci) 等。
    # 只取首个 `:` 前的 token，再去掉可能的 `(...)` 部分，留下纯 type。
    # 之前只支持无 scope 的 `fix: ...` / `feat: ...`，本仓库大量用 `fix(compat):`
    # 这种 scoped 形式，导致这部分 commit 整段被静默丢弃。
    type="${subject%%:*}"
    type="${type%%(*}"
    rest="${subject#*: }"
    if [ "$type" = "fix" ]; then
      if git diff-tree --no-commit-id --name-only -r "$hash" 2>/dev/null | grep -q "^$sub/"; then
        echo "  - fix: $rest"
      fi
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
