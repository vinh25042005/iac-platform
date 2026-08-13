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
# LƯU Ý: Ansible chạy local-exec SSH vào master. Nếu để trống → KHÔNG SSH được →
# job treo ở "chờ master ...". Set CIDR (VD IP nhà bạn/0.0.0.0/0) nếu cần.
variable "allowed_ssh_cidrs" {
  type    = list(string)
  default = ["0.0.0.0/0"]
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
  description = "Tổng số node (1 master + worker). Điền số bạn muốn."
}

variable "master_node_index" {
  type        = number
  default     = 0
  description = "Node index nào làm master (public subnet, có public IP — kubeadm init + NLB upstream). Worker = các node còn lại."
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

# ── Rancher standalone (EC2 riêng, NGOÀI cụm K8s — quản lý cluster qua kubeconfig) ──
variable "enable_rancher" {
  type    = bool
  default = false
  description = "Tạo EC2 riêng chạy Rancher Server (Docker) — chọn service 'rancher' khi tạo project"
}

variable "rancher_version" {
  type    = string
  default = "2.11.3"
  description = "Rancher version tag. v2.11.3 = tag Docker cao nhất nhánh 2.11, hỗ trợ import K8s 1.30-1.32"
}

variable "rancher_bootstrap_password" {
  type        = string
  default     = "admin"
  sensitive   = true
  description = "Bootstrap password Rancher (đổi trong production)"
}

# ── Vault (lưu kubeconfig — nguồn chuẩn thay SSM) ──
variable "vault_addr" {
  type    = string
  default = ""
  description = "Vault URL — ansible push kubeconfig lên secret/k8s/<project>-<env>, terraform đọc lại từ Vault"
}
variable "vault_token" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Vault token (có quyền ghi secret/k8s/*)"
}

# ── ArgoCD (chọn false khi muốn cluster K8s trần — deploy bằng kubectl/helm trực tiếp) ──
variable "enable_argocd" {
  type        = bool
  default     = true
  description = "Cài ArgoCD lên cluster hay không. false = cluster K8s trần (dùng cho CICD-AIO deploy qua kubectl set image, không cần ArgoCD)"
}
