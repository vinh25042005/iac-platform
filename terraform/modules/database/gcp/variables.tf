variable "project" {
  type = string
}

variable "env" {
  type = string
}

variable "region" {
  type    = string
  default = "asia-southeast1"
}

variable "tier" {
  type    = string
  default = "db-f1-micro"
}
