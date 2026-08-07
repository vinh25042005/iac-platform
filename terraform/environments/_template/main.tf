# ─────────────────────────────────────────────────────────────────────────────
# environments/_template/main.tf
# MẪU cho 1 (project × env) — AWS-only. new-project.sh copy thư mục này rồi set env.
# ─────────────────────────────────────────────────────────────────────────────
terraform {
  backend "s3" {
    bucket  = "iac-platform-state"
    key     = "KEY_PLACEHOLDER" # ← new-project.sh thay = <project>/<env>/terraform.tfstate
    region  = "ap-southeast-1"
    encrypt = true
  }
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = var.region
}

# ── Module network (AWS) ──
module "network" {
  source            = "../../../modules/network/aws"
  project           = var.project
  env               = var.env
  vpc_cidr          = var.vpc_cidr
  azs               = var.azs
  public_subnets    = var.public_subnets
  private_subnets   = var.private_subnets
  enable_nat        = var.enable_nat
  allowed_ssh_cidrs = var.allowed_ssh_cidrs
  allowed_api_cidrs = var.allowed_api_cidrs
  allowed_web_cidrs = var.allowed_web_cidrs
}

# ── Module kubernetes (AWS EKS) — node chạy trong PRIVATE subnet (an toàn hơn, ra internet qua NAT) ──
module "kubernetes" {
  source           = "../../../modules/kubernetes/aws"
  project          = var.project
  env              = var.env
  cluster_role_arn = var.eks_role_arn
  subnet_ids       = module.network.private_subnet_ids
}
