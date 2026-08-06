# Module kubernetes (GCP) — GKE skeleton (cấu trúc mẫu)
terraform {
  required_providers {
    google = { source = "hashicorp/google", version = "~> 5.0" }
  }
}

resource "google_container_cluster" "this" {
  name               = "${var.project}-${var.env}-gke"
  location           = var.region
  initial_node_count = var.node_count
  # NOTE: node_pool / IAM / VPC-native — bổ sung theo nhu cầu
}
