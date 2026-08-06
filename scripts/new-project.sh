#!/usr/bin/env bash
# =============================================================================
# new-project.sh — sinh toàn bộ scaffold cho 1 dự án mới trên iac-platform
#
# Usage: new-project.sh <PROJECT> <CLOUD>
#   VD:   ./scripts/new-project.sh techshop aws
#         ./scripts/new-project.sh billing  gcp
#
# Sinh: terraform/environments/<PROJECT>/{dev,stg,prd}/<CLOUD>/
#       helm/<PROJECT>/  +  argocd/apps/<PROJECT>-<env>.yaml
#       đăng ký vào projects.txt
# =============================================================================
set -euo pipefail

PROJECT="${1:?usage: new-project.sh <PROJECT> <CLOUD>}"
CLOUD="${2:?usage: new-project.sh <PROJECT> <CLOUD>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE_BUCKET="${STATE_BUCKET:-iac-platform-state}"
REGION="${AWS_REGION:-ap-southeast-1}"
ORIGIN="${GIT_ORIGIN:-https://github.com/<your-org>/iac-platform.git}"
ENVS="${ENVS:-dev stg prd}"
TEMPLATE="$ROOT/terraform/environments/_template"

case "$CLOUD" in aws|gcp) ;; *) echo "❌ CLOUD phải là aws|gcp"; exit 1;; esac
[ -d "$TEMPLATE" ] || { echo "❌ Không thấy $TEMPLATE"; exit 1; }

echo ">>> [1/4] Terraform environments ($PROJECT × $ENVS × $CLOUD)..."
for env in $ENVS; do
  dst="$ROOT/terraform/environments/$PROJECT/$env/$CLOUD"
  mkdir -p "$dst"
  cp "$TEMPLATE/main.tf"      "$dst/main.tf"
  cp "$TEMPLATE/variables.tf" "$dst/variables.tf"
  sed -i "s|KEY_PLACEHOLDER|$PROJECT/$env/$CLOUD/terraform.tfstate|" "$dst/main.tf"
  # Rewrite module path: template ở depth 1 (_template) nhưng env ở depth 3
  # (_template: ../../../modules  →  env: ../../../../modules)
  sed -i 's|\.\./\.\./\.\./modules/|../../../../modules/|g' "$dst/main.tf"
  cat > "$dst/terraform.tfvars" <<EOF
project = "$PROJECT"
env     = "$env"
cloud   = "$CLOUD"
region  = "$REGION"
EOF
  echo "  ✅ $dst"
done

echo ">>> [2/4] Helm chart..."
if [ -d "$ROOT/helm/_template" ]; then
  cp -r "$ROOT/helm/_template" "$ROOT/helm/$PROJECT"
  sed -i "s|name: _template|name: $PROJECT|" "$ROOT/helm/$PROJECT/Chart.yaml"
  echo "  ✅ helm/$PROJECT"
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
    path: helm/$PROJECT
    helm:
      valueFiles: ["env/values-$env.yaml"]
  destination:
    server: https://kubernetes.default.svc
    namespace: $PROJECT-$env
  syncPolicy:
    automated: { prune: true, selfHeal: true }
EOF
done
echo "  ✅ argocd/apps/$PROJECT-*.yaml"

echo ">>> [4/4] Đăng ký project..."
grep -q "^$PROJECT " "$ROOT/projects.txt" 2>/dev/null || echo "$PROJECT $CLOUD" >> "$ROOT/projects.txt"

echo ""
echo "✅ Đã sinh project '$PROJECT' ($CLOUD)."
echo "   - Nhớ thêm '$PROJECT' vào dropdown PROJECT trong Jenkinsfile."
echo "   - State bucket: $STATE_BUCKET (chạy scripts/env-init.sh nếu chưa có)."
