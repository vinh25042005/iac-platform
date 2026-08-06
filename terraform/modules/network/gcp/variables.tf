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

variable "subnet_cidr" {
  type    = string
  default = "10.0.1.0/24"
}
