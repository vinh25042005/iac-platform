# Module kubernetes (AWS) — EKS skeleton (cấu trúc mẫu, tuỳ chỉnh thêm)
terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

resource "aws_eks_cluster" "this" {
  name     = "${var.project}-${var.env}-eks"
  role_arn = var.cluster_role_arn
  vpc_config {
    subnet_ids = var.subnet_ids
  }
  enabled_cluster_log_types = ["api", "audit"]
  tags                      = { Name = "${var.project}-${var.env}-eks" }
}

# NOTE: node group / Fargate / IAM role / OIDC — bổ sung theo nhu cầu
