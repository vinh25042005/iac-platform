variable "project" {
  type = string
}

variable "env" {
  type = string
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "azs" {
  type    = list(string)
  default = ["ap-southeast-1a", "ap-southeast-1b"]
}

variable "public_subnets" {
  type    = list(string)
  default = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnets" {
  type    = list(string)
  default = ["10.0.10.0/24", "10.0.20.0/24"]
}

variable "enable_nat" {
  type    = bool
  default = true
}

# ⚠️ Security (least privilege): SSH CHỈ từ bastion/VPN — mặc định trống (không mở 22)
variable "allowed_ssh_cidrs" {
  type    = list(string)
  default = []
}

# K8s API + Rancher — nên giới hạn theo IP admin nếu có thể
variable "allowed_api_cidrs" {
  type    = list(string)
  default = ["0.0.0.0/0"]
}

# HTTP/HTTPS web public — OK để 0.0.0.0/0
variable "allowed_web_cidrs" {
  type    = list(string)
  default = ["0.0.0.0/0"]
}
