# 🏗️ iac-platform

> **IaC + CI/CD + GitOps "all-in-one"** — một repo source duy nhất, một pipeline duy nhất,
> tái sử dụng cho **mọi dự án × mọi môi trường × mọi cloud** (AWS/GCP...).

## Ý tưởng cốt lõi

```
Thêm dự án mới  →  scripts/new-project.sh <PROJECT> <CLOUD>
                 → sinh: environments + helm + argocd + đăng ký PROJECT
Chạy hạ tầng     →  Jenkins MODE=infra  (terraform plan/apply theo project×env×cloud)
Chạy deploy app  →  Jenkins MODE=app    (build + scan + sign + GitOps → ArgoCD)
```

## Cấu trúc

```
iac-platform/
├── Jenkinsfile                        # 1 pipeline cho MỌI dự án/môi trường/cloud
├── Makefile                           # make new-project / plan / apply
├── projects.txt                       # registry các project đã đăng ký
├── terraform/
│   ├── modules/                       # tái sử dụng, per-provider
│   │   ├── network/{aws,gcp}/
│   │   ├── kubernetes/{aws,gcp}/
│   │   └── database/{aws,gcp}/
│   └── environments/                  # 1 dir / (project×env×cloud)
│       ├── _template/                 # bản mẫu (generator copy)
│       └── <project>/<env>/<cloud>/
├── helm/
│   └── _template/                     # chart dùng chung cho 1 app
├── argocd/
│   ├── root.yaml                      # App-of-apps
│   └── apps/_template.yaml            # Application mẫu per (project×env)
├── scripts/
│   ├── new-project.sh                 # generator: sinh dự án mới
│   └── env-init.sh                    # khởi tạo remote state cho env
└── docs/GOLDEN-PATH.md                # hướng dẫn chi tiết
```

## Bắt đầu nhanh

```bash
# 1. Sinh dự án mới
./scripts/new-project.sh techshop aws

# 2. Chạy pipeline (Jenkins) MODE=infra để dựng hạ tầng cho techshop/stg/aws
# 3. Push code app → MODE=app → build + deploy qua ArgoCD
```

Chi tiết: [docs/GOLDEN-PATH.md](docs/GOLDEN-PATH.md)
