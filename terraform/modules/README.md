# ─────────────────────────────────────────────────────────────────────────────
# Modules — tái sử dụng cho mọi project × env (AWS)
#
# Quy tắc:
#   - Mỗi module đặt trong thư mục theo provider (aws/).
#   - Environment gọi module trực tiếp (không count pattern — xem environments/_template/main.tf).
#   - KHÔNG đặt secret vào module — secret luôn từ Vault runtime.
#
# Cách thêm module mới:
#   mkdir -p modules/<tên>/aws/
#   viết main.tf + variables.tf + outputs.tf
#   (rồi reference từ environments/_template/main.tf)
#
# Hiện có:
#   network/aws     — VPC/subnet/IGW/NAT/SG (functional)
#   kubernetes/aws  — kubeadm cluster (EC2 nodes + IAM SSM + inventory + join)
#   database/aws    — RDS (skeleton)
# ─────────────────────────────────────────────────────────────────────────────
