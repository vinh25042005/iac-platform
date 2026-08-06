# Module database (AWS) — RDS skeleton
terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

resource "aws_db_instance" "this" {
  identifier          = "${var.project}-${var.env}-db"
  engine              = "postgres"
  engine_version      = "16.4"
  instance_class      = var.instance_class
  allocated_storage   = var.allocated_storage
  db_name             = var.db_name
  username            = var.db_username
  password            = var.db_password
  skip_final_snapshot = true
  # NOTE: SG / subnet group / backup — bổ sung theo nhu cầu
}
