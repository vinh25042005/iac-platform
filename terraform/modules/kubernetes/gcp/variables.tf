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

variable "node_count" {
  type    = number
  default = 2
}
