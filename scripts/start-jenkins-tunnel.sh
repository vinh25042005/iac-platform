#!/usr/bin/env bash
# =============================================================================
# start-jenkins-tunnel.sh — SSH tunnel tới Jenkins VM qua port 22 (mở 0.0.0.0/0).
#
# TẠI SAO: Jenkins SG port 9090 chỉ mở cho IP máy portal (IP động → đổi mạng là
#          mất kết nối). SSH 22 thì mở cho MỌI IP → tunnel qua SSH là bền vững.
#          Backend dùng JENKINS_URL=http://localhost:9090 (chạy qua tunnel).
#
# CÁCH DÙNG:
#   ./scripts/start-jenkins-tunnel.sh           # dựng tunnel (nếu chưa có)
#   ./scripts/start-jenkins-tunnel.sh --status  # kiểm tra tunnel còn chạy?
#   ./scripts/start-jenkins-tunnel.sh --stop    # tắt tunnel
#   ./scripts/start-jenkins-tunnel.sh --restart # dựng lại (nếu mất kết nối)
#
# Sau đó chạy portal với JENKINS_URL=http://localhost:9090 (xem scripts/portal.sh).
# =============================================================================
set -euo pipefail

KEY="${JENKINS_SSH_KEY:-$HOME/.ssh/techshop-key.pem}"
HOST="${JENKINS_TUNNEL_HOST:-ubuntu@47.130.241.226}"
LPORT="${JENKINS_TUNNEL_LPORT:-9090}"
RPORT="${JENKINS_TUNNEL_RPORT:-9090}"

# Kiểm tra tunnel còn chạy không (cổng local đang lắng nghe)
is_up() { ss -ltn 2>/dev/null | grep -q "127.0.0.1:${LPORT} " || nc -z 127.0.0.1 "$LPORT" >/dev/null 2>&1; }

TMUX_SESSION="jenkins-tunnel"

# Script con chạy TRONG tmux: lặp ssh, nếu mất kết nối thì tự reconnect sau 5s.
# Script con chạy TRONG tmux: lặp ssh, mất kết nối thì tự reconnect sau 5s.
# Tạo trong start() để tránh bị stop() xoá giữa restart.
RUNNER="$HOME/.jenkins-tunnel-runner.sh"

make_runner() {
cat > "$RUNNER" <<EOF
#!/usr/bin/env bash
while true; do
  echo "[tunnel \$(date +%T)] connecting ${LPORT}:localhost:${RPORT} -> $HOST"
  ssh -i "$KEY" -o StrictHostKeyChecking=accept-new \\
      -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \\
      -o ExitOnForwardFailure=yes \\
      -N -L "${LPORT}:localhost:${RPORT}" "$HOST"
  echo "[tunnel] lost connection, retry in 5s"
  sleep 5
done
EOF
chmod +x "$RUNNER"
}

start() {
  if is_up; then
    echo "✅ Tunnel đã chạy (127.0.0.1:${LPORT}) — bỏ qua."
    return 0
  fi
  make_runner
  # Xoá session tmux cũ (nếu có) rồi tạo mới chạy runner (tự retry khi mất kết nối)
  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
  tmux new-session -d -s "$TMUX_SESSION" "$RUNNER"
  sleep 4
  if is_up; then
    echo "✅ Tunnel OK (tmux '$TMUX_SESSION') — backend nên dùng JENKINS_URL=http://localhost:${LPORT}"
  else
    echo "⚠️ Tunnel chưa lên — đang retry trong tmux. Kiểm tra: tmux attach -t $TMUX_SESSION"
  fi
}

stop() {
  echo ">>> Tắt tunnel ${LPORT}..."
  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
  pkill -f "ssh .* -L ${LPORT}:localhost:${RPORT} ${HOST}" 2>/dev/null || true
  echo "✅ Đã tắt (runner giữ lại cho lần start tới)."
}

status() {
  if is_up; then echo "✅ Tunnel đang chạy (127.0.0.1:${LPORT})."; else echo "❌ Tunnel KHÔNG chạy."; fi
}

case "${1:-start}" in
  start)    start ;;
  stop)     stop ;;
  restart)  stop; sleep 1; start ;;
  status)   status ;;
  *) echo "usage: $0 [start|stop|restart|status]"; exit 1 ;;
esac
