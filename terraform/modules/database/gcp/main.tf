# Module database (GCP) — CloudSQL skeleton
terraform {
  required_providers {
    google = { source = "hashicorp/google", version = "~> 5.0" }
  }
}

resource "google_sql_database_instance" "this" {
  name             = "${var.project}-${var.env}-db"
  region           = var.region
  database_version = "POSTGRES_16"
  settings {
    tier = var.tier
  }
  # NOTE: SG / private IP / backup — bổ sung theo nhu cầu
}
