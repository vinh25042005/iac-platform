#!/usr/bin/env bash
# =============================================================================
# new-project.sh — sinh toàn bộ scaffold cho 1 dự án mới trên iac-platform
#
# Usage: new-project.sh <PROJECT>
#   VD:   ./scripts/new-project.sh techshop
#
# Sinh: terraform/environments/<PROJECT>/{dev,stg,prd}/  (AWS-only)
#       helm/_base/values/<PROJECT>/   (chart dùng CHUNG + values riêng)
#       argocd/apps/<PROJECT>-<env>.yaml (trỏ tới helm/_base)
#       đăng ký vào projects.txt
# =============================================================================
set -euo pipefail

PROJECT_RAW="${1:?usage: new-project.sh <PROJECT>}"
# Chuẩn hoá tên project: lowercase, bỏ space/ký tự lạ, chỉ giữ a-z0-9-
PROJECT="$(printf '%s' "$PROJECT_RAW" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9-' '-')"
[ -n "$PROJECT" ] || { echo "❌ Tên project không hợp lệ sau khi chuẩn hoá: '$PROJECT_RAW'"; exit 1; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE_BUCKET="${STATE_BUCKET:-iac-platform-state}"
REGION="${AWS_REGION:-ap-southeast-1}"
ORIGIN="${GIT_ORIGIN:-https://github.com/<your-org>/iac-platform.git}"
ENVS="${ENVS:-dev stg prd}"
# Key pair AWS — Backstage truyền qua env KEY_NAME (VD: techshop-key).
# Nếu không truyền, fallback về <project>-key (giữ hành vi cũ).
KEY_NAME="${KEY_NAME:-$PROJECT-key}"
# Số node + node nào làm master — Backstage truyền qua env (tùy chọn trên UI).
NODE_COUNT="${NODE_COUNT:-3}"
MASTER_NODE_INDEX="${MASTER_NODE_INDEX:-0}"
# Rancher standalone (chọn service "rancher" trên UI) — true/false.
ENABLE_RANCHER="${ENABLE_RANCHER:-false}"
# ArgoCD — true: cài ArgoCD + tạo Application (mặc định).
#       false: cluster K8s trần, deploy trực tiếp kubectl/helm (dùng cho CICD-AIO deploy).
ENABLE_ARGOCD="${ENABLE_ARGOCD:-true}"
# Vault — nơi lưu kubeconfig (nguồn chuẩn thay SSM). Truyền VAULT_ADDR + VAULT_TOKEN khi tạo project.
VAULT_ADDR_ENV="${VAULT_ADDR:-}"
VAULT_TOKEN_ENV="${VAULT_TOKEN:-}"
# Loại máy EC2 — Backstage truyền qua env (chọn trên UI: t3.small/t3.medium/t3.large...)
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.small}"
# Docker registry — Backstage truyền qua env REGISTRY_BASE (VD: docker.io/vinh2504).
# Giá trị này được ghi vào helm/_base/values/<project>/values.yaml → images.repo
REGISTRY_BASE="${REGISTRY_BASE:-docker.io/youruser}"
# Tiền tố image — Backstage truyền qua env IMAGE_REPO_PREFIX (VD: dev → <repo>/dev-backend).
IMAGE_REPO_PREFIX="${IMAGE_REPO_PREFIX:-$PROJECT}"
TEMPLATE="$ROOT/terraform/environments/_template"

[ -d "$TEMPLATE" ] || { echo "❌ Không thấy $TEMPLATE"; exit 1; }

echo ">>> [1/4] Terraform environments ($PROJECT × $ENVS)..."
mkdir -p "$ROOT/ansible/inventories"
for env in $ENVS; do
  dst="$ROOT/terraform/environments/$PROJECT/$env"
  mkdir -p "$dst"
  cp "$TEMPLATE/main.tf"      "$dst/main.tf"
  cp "$TEMPLATE/variables.tf" "$dst/variables.tf"
  sed -i "s|KEY_PLACEHOLDER|$PROJECT/$env/terraform.tfstate|" "$dst/main.tf"
  cat > "$dst/terraform.tfvars" <<EOF
project = "$PROJECT"
env     = "$env"
region  = "$REGION"

# ── Cụm kubeadm (tùy chọn ngay trên Backstage khi tạo project) ──
key_name          = "$KEY_NAME"     # ← AWS key pair đã tạo (từ Backstage / mặc định <project>-key)
instance_type     = "$INSTANCE_TYPE"  # ← loại máy (t3.small/t3.medium/t3.large... chọn trên Backstage)
node_count        = $NODE_COUNT     # ← tổng số node (1 master + worker)
master_node_index = $MASTER_NODE_INDEX  # ← node nào làm master (0 = node đầu)

# ── Rancher standalone (chọn service "rancher" trên Backstage) ──
enable_rancher = $ENABLE_RANCHER   # true → EC2 riêng chạy Rancher (ngoài cụm K8s)

# ── ArgoCD ──
enable_argocd = $ENABLE_ARGOCD     # false → cluster K8s trần (deploy kubectl/helm, không ArgoCD)

# ── Vault (lưu kubeconfig — nguồn chuẩn thay SSM) ──
vault_addr = "$VAULT_ADDR_ENV"   # VD https://52.221.18.86:8200
vault_token = "$VAULT_TOKEN_ENV" # token có quyền ghi secret/k8s/*
EOF
  echo "  ✅ $dst"
done

echo ">>> [2/4] Helm values (chart dùng CHUNG helm/_base + values riêng)..."
VDIR="$ROOT/helm/_base/values/$PROJECT"
EXAMPLE="$ROOT/helm/_base/values/_example"
if [ -d "$EXAMPLE" ]; then
  mkdir -p "$VDIR"
  cp "$EXAMPLE/values.yaml" "$VDIR/values.yaml"
  sed -i \
    -e "s|project: myproject|project: $PROJECT|" \
    -e "s|docker.io/youruser|$REGISTRY_BASE|" \
    -e "s|myproject|$PROJECT|g" \
    "$VDIR/values.yaml"
  echo "  ✅ helm/_base/values/$PROJECT/ (images.repo=$REGISTRY_BASE)"
  for env in $ENVS; do
    cp "$EXAMPLE/values-$env.yaml" "$VDIR/values-$env.yaml"
  done
  echo "  ✅ helm/_base/values/$PROJECT/"
else
  echo "  ⚠️ Không thấy $EXAMPLE — bỏ qua helm values"
fi

echo ">>> [3/4] ArgoCD apps..."
if [ "$ENABLE_ARGOCD" = "true" ]; then
  mkdir -p "$ROOT/argocd/apps"
  for env in $ENVS; do
    cat > "$ROOT/argocd/apps/$PROJECT-$env.yaml" <<EOF
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: $PROJECT-$env
  namespace: argocd
  finalizers: [resources-finalizer.argocd.argoproj.io]
spec:
  project: default
  source:
    repoURL: $ORIGIN
    targetRevision: main
    path: helm/_base
    helm:
      valueFiles:
        - values/$PROJECT/values.yaml
        - values/$PROJECT/values-$env.yaml
  destination:
    server: https://kubernetes.default.svc
    namespace: $PROJECT-$env
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions:
      - CreateNamespace=true
EOF
  done
  echo "  ✅ argocd/apps/$PROJECT-*.yaml"
else
  echo "  ⏭️ Bỏ qua ArgoCD apps (ENABLE_ARGOCD=false — cluster K8s trần, deploy kubectl/helm trực tiếp)"
fi

echo ">>> [4/4] Đăng ký project..."
grep -q "^$PROJECT " "$ROOT/projects.txt" 2>/dev/null || echo "$PROJECT" >> "$ROOT/projects.txt"

echo ""
echo "✅ Đã sinh project '$PROJECT' (AWS)."
echo "   - Nhớ thêm '$PROJECT' vào dropdown PROJECT trong Jenkinsfile."
echo "   - State bucket: $STATE_BUCKET (chạy scripts/env-init.sh nếu chưa có)."
