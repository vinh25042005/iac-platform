variable "project" {
  type = string
}

variable "env" {
  type = string
}

variable "cluster_role_arn" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}
