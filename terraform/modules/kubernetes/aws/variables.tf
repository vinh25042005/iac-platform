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

# ── Network (từ module network/aws) ──
variable "public_subnet_id" {
  type = string
  description = "Public subnet (AZ a) — master node"
}

variable "private_subnet_ids" {
  type = list(string)
  description = "Private subnets — worker nodes"
}

variable "sg_ids" {
  type = list(string)
  description = "Security group ids cho node (allow_internal + allow_api)"
}

variable "key_name" {
  type    = string
  default = ""
  description = "AWS EC2 key pair name"
}

# ── Instance ──
variable "instance_type" {
  type    = string
  default = "t3.small"
}

variable "node_count" {
  type    = number
  default = 3
  description = "Tổng số node (node[0]=master public, còn lại worker private). Điền số bạn muốn."
}

variable "disk_size" {
  type    = number
  default = 30
}

# ── Cluster ──
variable "k8s_version" {
  type    = string
  default = "1.32"
}

variable "pod_cidr" {
  type    = string
  default = "10.244.0.0/16"
}

# ── Backup ──
variable "backup_bucket_name" {
  type    = string
  default = ""
}

# ── Ansible ──
variable "inventory_path" {
  type    = string
  default = ""
  description = "Đường dẫn ghi file inventory (VD: ../../ansible/inventories/<project>-<env>.ini)"
}
