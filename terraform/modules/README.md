# ─────────────────────────────────────────────────────────────────────────────
# Modules — tái sử dụng cho mọi project × env × cloud
#
# Quy tắc:
#   - Mỗi module có bản per-provider: aws/ (EKS/RDS/VPC) vs gcp/ (GKE/CloudSQL/VPC).
#   - Environment chọn module bằng biến `cloud` (count pattern — xem environments/_template/main.tf).
#   - KHÔNG đặt secret vào module — secret luôn từ Vault runtime.
#
# Cách thêm module provider mới:
#   mkdir -p modules/<tên>/<cloud>/
#   viết main.tf + variables.tf + outputs.tf
#   (rồi reference từ environments/_template/main.tf qua count)
#
# Hiện có:
#   network/{aws,gcp}     — VPC/subnet/IGW (functional)
#   kubernetes/{aws,gcp}  — EKS/GKE (skeleton — bổ sung theo nhu cầu)
#   database/{aws,gcp}    — RDS/CloudSQL (skeleton)
# ─────────────────────────────────────────────────────────────────────────────
