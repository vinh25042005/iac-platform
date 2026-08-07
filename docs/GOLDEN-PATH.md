# 🧭 Golden Path — Cách dùng iac-platform

## 1. Thêm một dự án mới

```bash
./scripts/new-project.sh <PROJECT>
# VD: ./scripts/new-project.sh techshop
```

Script tự sinh:
- `terraform/environments/<PROJECT>/{dev,stg,prd}/` (main.tf, variables, backend, tfvars)
- `helm/_base/values/<PROJECT>/` (chart dùng chung + values theo env)
- `argocd/apps/<PROJECT>-<env>.yaml` cho từng env
- Đăng ký `<PROJECT>` vào `projects.txt`

> Sau đó mở `Jenkinsfile` → thêm `<PROJECT>` vào dropdown `PROJECT` (hoặc để script tự làm).

## 2. Dựng hạ tầng (MODE=infra)

Chạy 1 lần khi thêm env hoặc khi sửa IaC:

```bash
# Local:
make plan PROJ=techshop ENV=stg
make apply PROJ=techshop ENV=stg

# Hoặc qua Jenkins (param MODE=infra, INFRA_ACTION=plan|apply, PROJECT/ENV)
```

Remote state tách riêng theo `(project, env)` — an toàn, không đụng nhau.

## 3. Deploy app (MODE=app)

- Push code lên repo app → (tuỳ chọn) webhook Jenkins.
- Jenkins `MODE=app` với `PROJECT/ENV`:
  1. Đọc secret từ Vault (plugin, AppRole)
  2. Build image `docker.io/<user>/<PROJECT>-backend|frontend:<ENV>-<tag>`
  3. Scan (Trivy) + SBOM (Syft) + Sign (cosign) + SLSA attest
  4. Cập nhật image tag trong `helm/<PROJECT>/env/values-<ENV>.yaml` (hoặc `.argocd-source-<PROJECT>-<ENV>.yaml`)
  5. Push → ArgoCD sync → deploy

## 4. Nguyên tắc

- **1 nguồn**: mọi thứ nằm trong repo này (IaC + chart + app-of-apps + pipeline).
- **Modules**: `modules/network/aws`, `modules/kubernetes/aws`, `modules/database/aws`.
- **State tách biệt** per (project×env).
- **Secret chỉ ở Vault** — không bao giờ trong code/image.
