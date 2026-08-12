#!/usr/bin/env bash
# =============================================================================
# allow-portal-ip.sh — tự cập nhật SG Jenkins theo IP hiện tại của máy portal.
#
# VẤN ĐỀ: Jenkins SG mở port 9090 cho IP của máy chạy portal. Nếu máy đổi mạng
#         (IP động — nhà dân / wifi / 4G) → IP đổi → backend không gọi được Jenkins.
#
# CÁCH DÙNG:
#   ./scripts/allow-portal-ip.sh            # thêm IP hiện tại vào SG (nếu chưa có)
#   ./scripts/allow-portal-ip.sh --remove   # xoá rule IP portal (giữ GitHub ranges)
#
# Giữ NGUYÊN các rule IP GitHub (Jenkins webhook từ GitHub) — chỉ quản lý rule IP portal.
# IP portal = rule 9090 KHÔNG nằm trong dải GitHub.
# =============================================================================
set -euo pipefail

SG_ID="${JENKINS_SG_ID:-sg-002fa49707b6cf16f}"
PORT=9090

# GitHub webhook IP ranges — KHÔNG được xoá
GITHUB_RANGES=(
  "140.82.112.0/20"
  "185.199.108.0/22"
  "192.30.252.0/22"
  "143.55.64.0/20"
)

is_github() { local c="$1"; for r in "${GITHUB_RANGES[@]}"; do [[ "$c" == "$r" ]] && return 0; done; return 1; }

# ── Lấy IP hiện tại (public) ──
IP="$(curl -s --max-time 8 ifconfig.me)"
echo ">>> IP hiện tại: $IP"

# ── Liệt kê rule 9090 hiện có ──
mapfile -t CIDRS < <(aws ec2 describe-security-groups --group-ids "$SG_ID" \
  --query "SecurityGroups[0].IpPermissions[?FromPort==\`${PORT}\`].IpRanges[*].CidrIp" \
  --output text 2>/dev/null | tr '\t' '\n' | sed '/^$/d' || true)

PORTAL_CIDR="${IP}/32"

# ── Xoá các rule IP portal cũ (không phải GitHub) ──
REMOVED=0
for c in "${CIDRS[@]:-}"; do
  if ! is_github "$c"; then
    echo "  → xoá rule portal cũ: $c"
    aws ec2 revoke-security-group-ingress --group-id "$SG_ID" \
      --protocol tcp --port "$PORT" --cidr "$c" >/dev/null 2>&1 || true
    REMOVED=$((REMOVED+1))
  fi
done

# ── Thêm IP hiện tại (nếu chưa có) ──
if ! grep -qx "$PORTAL_CIDR" <(printf '%s\n' "${CIDRS[@]:-}"); then
  echo "  → thêm: $PORTAL_CIDR"
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --protocol tcp --port "$PORT" --cidr "$PORTAL_CIDR" >/dev/null
else
  echo "  → $PORTAL_CIDR đã có, bỏ qua"
fi

echo ""
echo "✅ Xong. Rule 9090 hiện tại:"
aws ec2 describe-security-groups --group-ids "$SG_ID" \
  --query "SecurityGroups[0].IpPermissions[?FromPort==\`${PORT}\`].IpRanges[*].CidrIp" \
  --output text 2>/dev/null | tr '\t' '\n' | sed '/^$/d'
