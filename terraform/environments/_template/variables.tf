variable "project" {
  type = string
}

variable "env" {
  type = string
}

variable "cloud" {
  type        = string
  description = "aws | gcp"
}

# AWS
variable "region" {
  type    = string
  default = "ap-southeast-1"
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "public_subnets" {
  type    = list(string)
  default = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "azs" {
  type    = list(string)
  default = ["ap-southeast-1a", "ap-southeast-1b"]
}

variable "eks_role_arn" {
  type    = string
  default = ""
}

# GCP
variable "gcp_project" {
  type    = string
  default = ""
}

variable "gcp_region" {
  type    = string
  default = "asia-southeast1"
}

variable "subnet_cidr" {
  type    = string
  default = "10.0.1.0/24"
}
