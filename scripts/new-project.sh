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

# ── Cụm kubeadm (sửa theo ý bạn) ──
key_name      = "$KEY_NAME"   # ← AWS key pair đã tạo (từ Backstage / mặc định <project>-key)
instance_type = "t3.small"
node_count    = 3                # ← điền số node (1 master + N-1 worker)
EOF
  echo "  ✅ $dst"
done

echo ">>> [2/4] Helm values (chart dùng CHUNG helm/_base + values riêng)..."
VDIR="$ROOT/helm/_base/values/$PROJECT"
EXAMPLE="$ROOT/helm/_base/values/_example"
if [ -d "$EXAMPLE" ]; then
  mkdir -p "$VDIR"
  cp "$EXAMPLE/values.yaml" "$VDIR/values.yaml"
  sed -i "s|project: myproject|project: $PROJECT|" "$VDIR/values.yaml"
  for env in $ENVS; do
    cp "$EXAMPLE/values-$env.yaml" "$VDIR/values-$env.yaml"
  done
  echo "  ✅ helm/_base/values/$PROJECT/"
else
  echo "  ⚠️ Không thấy $EXAMPLE — bỏ qua helm values"
fi

echo ">>> [3/4] ArgoCD apps..."
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

echo ">>> [4/4] Đăng ký project..."
grep -q "^$PROJECT " "$ROOT/projects.txt" 2>/dev/null || echo "$PROJECT" >> "$ROOT/projects.txt"

echo ""
echo "✅ Đã sinh project '$PROJECT' (AWS)."
echo "   - Nhớ thêm '$PROJECT' vào dropdown PROJECT trong Jenkinsfile."
echo "   - State bucket: $STATE_BUCKET (chạy scripts/env-init.sh nếu chưa có)."
