# 🏗️ iac-platform

> **IaC + CI/CD + GitOps "all-in-one"** — một repo source duy nhất, một pipeline duy nhất,
> tái sử dụng cho **mọi dự án × mọi môi trường** (AWS).

## Ý tưởng cốt lõi

```
Thêm dự án mới  →  scripts/new-project.sh <PROJECT>
                 → sinh: environments + helm + argocd + đăng ký PROJECT
Chạy hạ tầng     →  Jenkins MODE=infra  (terraform plan/apply theo project×env)
Chạy deploy app  →  Jenkins MODE=app    (build + scan + sign + GitOps → ArgoCD)
```

## Cấu trúc

```
iac-platform/
├── Jenkinsfile                        # 1 pipeline cho MỌI dự án/môi trường
├── Makefile                           # make new-project / plan / apply
├── projects.txt                       # registry các project đã đăng ký
├── terraform/
│   ├── modules/                       # tái sử dụng (AWS)
│   │   ├── network/aws/
│   │   ├── kubernetes/aws/
│   │   └── database/aws/
│   └── environments/                  # 1 dir / (project×env)
│       ├── _template/                 # bản mẫu (generator copy)
│       └── <project>/<env>/
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
./scripts/new-project.sh techshop

# 2. Chạy pipeline (Jenkins) MODE=infra để dựng hạ tầng cho techshop/stg
# 3. Push code app → MODE=app → build + deploy qua ArgoCD
```

Chi tiết: [docs/GOLDEN-PATH.md](docs/GOLDEN-PATH.md)
