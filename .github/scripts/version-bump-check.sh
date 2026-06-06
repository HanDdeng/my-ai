#!/usr/bin/env bash
# 校验 PR 是否在改子项目代码时同步 bump version。
# 失败时非零退出并打印哪一端不满足。
set -uo pipefail

BASE="${1:-origin/main}"
HEAD="${2:-HEAD}"

if ! git rev-parse "$BASE" >/dev/null 2>&1; then
  echo "✖ base $BASE 不存在"; exit 1
fi

changed=$(git diff --name-only "$BASE"..."$HEAD" 2>/dev/null || git diff --name-only "$HEAD")
fail() { echo "✖ $1"; exit 1; }

# client：src/ 或 src-tauri/ 下代码改了 → package.json + tauri.conf.json 都要改
# src/ 分支必须用 src/.* 吃掉余下路径，不能写成 src/$ —— 否则 $ 锚会强制 src/ 出现在行尾，
# 只能匹配恰好叫 "client/src" 的单文件，捕获不到 client/src/foo.ts。
client_code=$(echo "$changed" | grep -E '^client/(src/.*|src-tauri/.*\.(rs|toml))$' || true)
client_pkg=$(echo "$changed" | grep -E '^client/package\.json$' || true)
client_tauri=$(echo "$changed" | grep -E '^client/src-tauri/tauri\.conf\.json$' || true)
if [ -n "$client_code" ] && { [ -z "$client_pkg" ] || [ -z "$client_tauri" ]; }; then
  fail "client 代码有变更但未同步 bump client/package.json 和 client/src-tauri/tauri.conf.json"
fi

# gateway / core：src/ 改了 → package.json 必须改
for sub in gateway core; do
  code=$(echo "$changed" | grep -E "^$sub/src/" || true)
  pkg=$(echo "$changed" | grep -E "^$sub/package\.json$" || true)
  if [ -n "$code" ] && [ -z "$pkg" ]; then
    fail "$sub 代码有变更但未 bump $sub/package.json"
  fi
done

echo "✓ version bump 检查通过"
