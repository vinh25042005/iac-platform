#!/usr/bin/env bash
# =============================================================================
# portal.sh — khởi động Backstage portal kèm SSH tunnel tới Jenkins.
#
#  1. Dựng SSH tunnel 9090 → Jenkins (bền vững với IP động, qua port 22)
#  2. Chạy portal với JENKINS_URL=http://localhost:9090 + VAULT/Jenkins creds
#
# CÁCH DÙNG:
#   ./scripts/portal.sh start   # dựng tunnel + chạy portal (nền, log /tmp/portal.log)
#   ./scripts/portal.sh stop    # tắt portal (giữ tunnel nếu muốn dùng lại)
#   ./scripts/portal.sh status  # kiểm tra portal + tunnel
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORTAL="$ROOT/portal"

# ── Env (credentials) ──
# Nạp từ scripts/portal.env (KHÔNG commit — file này nằm trong .gitignore).
# Nếu không có file đó → dùng giá trị từ env (nếu bạn export tay).
ENV_FILE="$(cd "$(dirname "$0")" && pwd)/portal.env"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi
export JENKINS_USER="${JENKINS_USER:-admin}"
export JENKINS_TOKEN="${JENKINS_TOKEN:-}"
export JENKINS_URL="${JENKINS_URL:-http://localhost:9090}"   # ← qua SSH tunnel
export VAULT_ADDR="${VAULT_ADDR:-https://52.221.18.86:8200}"
export VAULT_TOKEN="${VAULT_TOKEN:-}"

# ── Tunnel helper ──
TUNNEL="$ROOT/scripts/start-jenkins-tunnel.sh"

start() {
  "$TUNNEL" start
  echo ">>> Khởi động portal (JENKINS_URL=$JENKINS_URL)..."
  cd "$PORTAL"
  # < /dev/null để tránh lỗi EBADF khi chạy nền
  nohup yarn start < /dev/null > /tmp/portal.log 2>&1 &
  echo "   pid $! — log: /tmp/portal.log"
}

stop() {
  echo ">>> Tắt portal..."
  pkill -f 'backstage-cli.*start' 2>/dev/null || true
  sleep 1
  echo "   (Tunnel để nguyên — muốn tắt: $TUNNEL stop)"
}

status() {
  "$TUNNEL" status
  echo "--- portal ---"
  if ss -ltn 2>/dev/null | grep -qE ':3005 |:7007 '; then
    echo "✅ Portal đang chạy (3005 + 7007)"
  else
    echo "❌ Portal không chạy"
  fi
}

case "${1:-start}" in
  start)  start ;;
  stop)   stop ;;
  status) status ;;
  *) echo "usage: $0 [start|stop|status]"; exit 1 ;;
esac
