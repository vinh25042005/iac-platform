# ─────────────────────────────────────────────────────────────────────────────
# environments/_template/main.tf
# MẪU cho 1 (project × env × cloud). new-project.sh copy thư mục này rồi set cloud.
#
# Điểm mấu chốt: module `source` KHÔNG thể động — nên dùng COUNT PATTERN:
#   var.cloud == "aws" → dùng module .../network/aws
#   var.cloud == "gcp" → dùng module .../network/gcp
# ─────────────────────────────────────────────────────────────────────────────
terraform {
  backend "s3" {
    bucket  = "iac-platform-state"
    key     = "KEY_PLACEHOLDER" # ← new-project.sh thay = <project>/<env>/<cloud>/terraform.tfstate
    region  = "ap-southeast-1"
    encrypt = true
  }
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.0" }
    google = { source = "hashicorp/google", version = "~> 5.0" }
  }
}

provider "aws" {
  region = var.region
}

provider "google" {
  project = var.gcp_project
  region  = var.gcp_region
}

# ── Module network: chọn theo cloud ──
module "network_aws" {
  count          = var.cloud == "aws" ? 1 : 0
  source         = "../../../modules/network/aws"
  providers      = { aws = aws }
  project        = var.project
  env            = var.env
  vpc_cidr       = var.vpc_cidr
  public_subnets = var.public_subnets
  azs            = var.azs
}

module "network_gcp" {
  count       = var.cloud == "gcp" ? 1 : 0
  source      = "../../../modules/network/gcp"
  providers   = { google = google }
  project     = var.project
  env         = var.env
  region      = var.gcp_region
  subnet_cidr = var.subnet_cidr
}

# ── Module kubernetes: chọn theo cloud ──
module "kubernetes_aws" {
  count            = var.cloud == "aws" ? 1 : 0
  source           = "../../../modules/kubernetes/aws"
  providers        = { aws = aws }
  project          = var.project
  env              = var.env
  cluster_role_arn = var.eks_role_arn
  subnet_ids       = concat(module.network_aws[*].public_subnet_ids, [[]])[0]
}

module "kubernetes_gcp" {
  count     = var.cloud == "gcp" ? 1 : 0
  source    = "../../../modules/kubernetes/gcp"
  providers = { google = google }
  project   = var.project
  env       = var.env
  region    = var.gcp_region
}
