variable "project" {
  type = string
}

variable "env" {
  type = string
}

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

variable "private_subnets" {
  type    = list(string)
  default = ["10.0.10.0/24", "10.0.20.0/24"]
}

variable "enable_nat" {
  type    = bool
  default = true
}

variable "azs" {
  type    = list(string)
  default = ["ap-southeast-1a", "ap-southeast-1b"]
}

# ⚠️ Security (least privilege): SSH chỉ từ bastion/VPN — mặc định trống (không mở 22)
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

# ── Cụm kubeadm ──
variable "key_name" {
  type        = string
  default     = ""
  description = "AWS EC2 key pair name (tạo 1 lần: aws ec2 create-key-pair)"
}

variable "instance_type" {
  type    = string
  default = "t3.small"
}

variable "node_count" {
  type        = number
  default     = 3
  description = "Tổng số node (node[0]=master public, còn lại worker private). Điền số bạn muốn."
}

variable "disk_size" {
  type    = number
  default = 30
}

variable "k8s_version" {
  type    = string
  default = "1.32"
}

variable "pod_cidr" {
  type    = string
  default = "10.244.0.0/16"
}

variable "backup_bucket_name" {
  type    = string
  default = ""
}
