# 🧭 Golden Path — Cách dùng iac-platform

## 1. Thêm một dự án mới

```bash
./scripts/new-project.sh <PROJECT> <CLOUD>
# VD: ./scripts/new-project.sh techshop aws
#     ./scripts/new-project.sh billing gcp
```

Script tự sinh:
- `terraform/environments/<PROJECT>/{dev,stg,prd}/<CLOUD>/` (main.tf, variables, backend, tfvars)
- `helm/<PROJECT>/` (chart dùng chung + values theo env)
- `argocd/apps/<PROJECT>-<env>.yaml` cho từng env
- Đăng ký `<PROJECT> <CLOUD>` vào `projects.txt`

> Sau đó mở `Jenkinsfile` → thêm `<PROJECT>` vào dropdown `PROJECT` (hoặc để script tự làm).

## 2. Dựng hạ tầng (MODE=infra)

Chạy 1 lần khi thêm env/cloud hoặc khi sửa IaC:

```bash
# Local:
make plan PROJ=techshop ENV=stg CLOUD=aws
make apply PROJ=techshop ENV=stg CLOUD=aws

# Hoặc qua Jenkins (param MODE=infra, INFRA_ACTION=plan|apply, PROJECT/ENV/CLOUD)
```

Remote state tách riêng theo `(project, env, cloud)` — an toàn, không đụng nhau.

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
- **Per-provider modules**: `modules/network/aws` vs `gcp` — chọn bằng biến `cloud` (count pattern).
- **State tách biệt** per (project×env×cloud).
- **Secret chỉ ở Vault** — không bao giờ trong code/image.
