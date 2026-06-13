#!/usr/bin/env bash
# v6.3 三端真联调：起 core (v6.1) + gateway (v6.2) + client (v6.3) 三个进程到后台。
# - core:  127.0.0.1:8788
# - gateway: 127.0.0.1:8787（CORE_URL → core）
# - client: 127.0.0.1:5173（vite dev，浏览器开）
# 所有日志写到 .integration-logs/；PIDs 写到 .integration-logs/pids.env；Ctrl-C / EXIT trap 清理。
#
# 用法：
#   ./scripts/integration-test.sh start    # 起 3 端
#   ./scripts/integration-test.sh stop     # 停 3 端
#   ./scripts/integration-test.sh status   # 查健康
#   ./scripts/integration-test.sh logs     # tail -f 三端日志

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$REPO_ROOT/.integration-logs"
PID_FILE="$LOG_DIR/pids.env"
mkdir -p "$LOG_DIR"

CORE_PORT="${CORE_PORT:-8788}"
GATEWAY_PORT="${GATEWAY_PORT:-8787}"
CLIENT_PORT="${CLIENT_PORT:-5173}"
CORE_URL="http://127.0.0.1:${CORE_PORT}"
GATEWAY_URL="http://127.0.0.1:${GATEWAY_PORT}"
CLIENT_URL="http://127.0.0.1:${CLIENT_PORT}"

# 写 PID 到 env 文件（供 stop / status 跨进程读）
write_pids() {
  cat > "$PID_FILE" <<EOF
# 三端联调进程 PIDs（自动生成于 $(date -Iseconds)）
CORE_PID=${CORE_PID:-}
GATEWAY_PID=${GATEWAY_PID:-}
CLIENT_PID=${CLIENT_PID:-}
EOF
}

# 读 PID
load_pids() {
  if [ -f "$PID_FILE" ]; then
    # shellcheck disable=SC1090
    source "$PID_FILE"
  fi
}

# 等待端口就绪（curl 探活；最多 30s）
wait_for_port() {
  local url="$1" name="$2" max="${3:-30}"
  echo "⏳ 等待 $name 就绪 $url ..."
  for i in $(seq 1 "$max"); do
    if curl -sf -o /dev/null "$url" 2>/dev/null; then
      echo "  ✓ $name 就绪（$i s）"
      return 0
    fi
    sleep 1
  done
  echo "  ✖ $name $max 秒未就绪"
  return 1
}

start_three() {
  # 先 stop 任何残留
  stop_three || true

  echo ""
  echo "=== 起 core（v6.1，端口 $CORE_PORT）==="
  CORE_PID=""
  nohup pnpm -C "$REPO_ROOT/core" dev \
    > "$LOG_DIR/core.log" 2>&1 &
  CORE_PID=$!
  echo "  core pid=$CORE_PID"
  wait_for_port "$CORE_URL/health" "core" 30 || return 1

  echo ""
  echo "=== 起 gateway（v6.2，端口 $GATEWAY_PORT，→ $CORE_URL）==="
  GATEWAY_PID=""
  CORE_URL="$CORE_URL" GATEWAY_PAIRING_PUBLIC=true \
    nohup pnpm -C "$REPO_ROOT/gateway" dev \
    > "$LOG_DIR/gateway.log" 2>&1 &
  GATEWAY_PID=$!
  echo "  gateway pid=$GATEWAY_PID"
  wait_for_port "$GATEWAY_URL/health" "gateway" 30 || return 1

  echo ""
  echo "=== 起 client（v6.3 vite dev，端口 $CLIENT_PORT）==="
  CLIENT_PID=""
  nohup pnpm -C "$REPO_ROOT/client" dev \
    --host 127.0.0.1 \
    > "$LOG_DIR/client.log" 2>&1 &
  CLIENT_PID=$!
  echo "  client pid=$CLIENT_PID"
  wait_for_port "$CLIENT_URL" "client" 60 || return 1

  write_pids
  echo ""
  echo "✅ 三端就绪："
  echo "  core:    $CORE_URL  (pid $CORE_PID)"
  echo "  gateway: $GATEWAY_URL  (pid $GATEWAY_PID)"
  echo "  client:  $CLIENT_URL  (pid $CLIENT_PID)"
  echo ""
  echo "日志目录: $LOG_DIR"
  echo "查看实时: $0 logs"
  echo "停三端:   $0 stop"
}

stop_three() {
  load_pids
  local killed=0
  for var in CLIENT_PID GATEWAY_PID CORE_PID; do
    local pid="${!var:-}"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "  停 $var (pid $pid) ..."
      kill "$pid" 2>/dev/null || true
      killed=$((killed + 1))
    fi
  done
  # 等 3s 优雅退出；不杀就 SIGKILL
  if [ "$killed" -gt 0 ]; then
    sleep 3
    for var in CLIENT_PID GATEWAY_PID CORE_PID; do
      local pid="${!var:-}"
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    done
  fi
  rm -f "$PID_FILE"
  echo "✓ 三端已停"
}

status_three() {
  echo "=== 三端健康 ==="
  for entry in "core:$CORE_URL/health" "gateway:$GATEWAY_URL/health" "client:$CLIENT_URL"; do
    local name="${entry%%:*}"
    local url="${entry#*:}"
    local status
    if status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null); then
      printf "  %-10s %-40s HTTP %s\n" "$name" "$url" "$status"
    else
      printf "  %-10s %-40s (无响应)\n" "$name" "$url"
    fi
  done
}

logs_three() {
  if [ ! -d "$LOG_DIR" ]; then
    echo "日志目录不存在：$LOG_DIR（先 start）"
    return 1
  fi
  tail -F \
    <(echo "=== core ===";     tail -n +1 "$LOG_DIR/core.log"     2>/dev/null) \
    <(echo "=== gateway ===";  tail -n +1 "$LOG_DIR/gateway.log"  2>/dev/null) \
    <(echo "=== client ===";   tail -n +1 "$LOG_DIR/client.log"   2>/dev/null)
}

usage() {
  cat <<EOF
用法: $0 {start|stop|status|logs}

  start   起 core (8788) + gateway (8787) + client (5173) 三端到后台
  stop    停三端（用 $PID_FILE 里的 PID）
  status  curl 探三端 /health
  logs    tail -F 三端日志（实时交错）

环境变量覆盖端口:
  CORE_PORT (默认 8788)  GATEWAY_PORT (默认 8787)  CLIENT_PORT (默认 5173)

日志目录: $LOG_DIR
PID 文件: $PID_FILE
EOF
}

case "${1:-}" in
  start)  start_three ;;
  stop)   stop_three ;;
  status) status_three ;;
  logs)   logs_three ;;
  *)     usage; exit 1 ;;
esac
