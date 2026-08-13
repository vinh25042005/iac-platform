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
│   │   ├── network/aws/               # VPC 2 tầng + NAT + SG
│   │   ├── kubernetes/aws/            # kubeadm cluster (EC2 nodes + IAM + inventory)
│   │   └── database/aws/              # RDS skeleton
│   └── environments/                  # 1 dir / (project×env)
│       ├── _template/                 # bản mẫu (generator copy)
│       └── <project>/<env>/
├── ansible/
│   ├── playbooks/k8s-cluster.yml      # kubeadm init + join + Calico + ArgoCD
│   ├── roles/{common,master,worker}/  # cài node + init + join
│   └── inventories/                   # sinh tự động bởi Terraform
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

## Cụm K8s (kubeadm self-managed)

Giống cụm deploy-web: `node[0]` = master (public subnet), `node[1..]` = worker (private subnet).
Terraform dựng: VPC + EC2 + NLB + Ansible boot kubeadm (Calico, cert-manager, ArgoCD).
Kubeconfig lưu **VAULT** `secret/k8s/<project>-<env>` (nguồn chuẩn — pipeline/terraform đọc từ Vault); join command lưu SSM cho worker join.

## Bắt đầu nhanh

```bash
# 0. Tạo AWS key pair (1 lần)
aws ec2 create-key-pair --key-name techshop-key --region ap-southeast-1 --query 'KeyMaterial' --output text > ~/.ssh/techshop-key.pem && chmod 600 ~/.ssh/techshop-key.pem

# 1. Sinh dự án mới
./scripts/new-project.sh techshop
#    → sửa terraform/environments/techshop/stg/terraform.tfvars (key_name, node_count)

# 2. Dựng cụm (local)
make apply PROJ=techshop ENV=stg

#    Hoặc qua Jenkins MODE=infra
```

Chi tiết: [docs/GOLDEN-PATH.md](docs/GOLDEN-PATH.md)
