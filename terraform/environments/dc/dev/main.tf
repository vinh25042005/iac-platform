# ─────────────────────────────────────────────────────────────────────────────
# environments/_template/main.tf
# MẪU cho 1 (project × env) — AWS-only. new-project.sh copy thư mục này rồi set env.
#
# Cụm K8s: kubeadm self-managed (giống deploy-web)
#   - network: VPC 2 tầng + NAT + SG (least privilege)
#   - kubernetes: EC2 node[0]=master public + node[1..]=worker private
#   - NLB: trỏ vào node (ingress-nginx hostNetwork 80/443)
#   - Ansible: kubeadm init + join + Calico + cert-manager + ArgoCD
# ─────────────────────────────────────────────────────────────────────────────
terraform {
  backend "s3" {
    bucket  = "iac-platform-state-790400775134"
    key     = "dc/dev/terraform.tfstate" # ← new-project.sh thay = <project>/<env>/terraform.tfstate
    region  = "ap-southeast-1"
    encrypt = true
    # Chống 2 terraform (apply/destroy) đọc-ghi cùng state file song song
    dynamodb_table = "tfstate-lock"
  }
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
    helm = { source = "hashicorp/helm", version = "~> 3.0" }
    kubernetes = { source = "hashicorp/kubernetes", version = "~> 3.0" }
  }
}

provider "aws" {
  region = var.region
}

# ── Module network (AWS) ──
module "network" {
  source            = "../../../modules/network/aws"
  project           = var.project
  env               = var.env
  vpc_cidr          = var.vpc_cidr
  azs               = var.azs
  public_subnets    = var.public_subnets
  private_subnets   = var.private_subnets
  enable_nat        = var.enable_nat
  allowed_ssh_cidrs = var.allowed_ssh_cidrs
  allowed_api_cidrs = var.allowed_api_cidrs
  allowed_web_cidrs = var.allowed_web_cidrs
}

# ── Module kubernetes (kubeadm self-managed) ──
#   node[0] = master (public subnet), node[1..] = workers (private subnet)
#   node_count bạn tự điền trong terraform.tfvars
module "kubernetes" {
  source = "../../../modules/kubernetes/aws"

  project = var.project
  env     = var.env
  region  = var.region

  public_subnet_id    = module.network.public_subnet_ids[0]
  private_subnet_ids  = module.network.private_subnet_ids
  sg_ids              = [
    module.network.sg_allow_internal_id,
    module.network.sg_allow_api_id,
    module.network.sg_allow_web_id, 
  ]

  key_name      = var.key_name
  instance_type = var.instance_type
  node_count    = var.node_count
  master_node_index = var.master_node_index
  disk_size     = var.disk_size

  k8s_version = var.k8s_version
  pod_cidr    = var.pod_cidr

  backup_bucket_name = var.backup_bucket_name
  inventory_path     = "${path.root}/../../../../ansible/inventories/${var.project}-${var.env}.ini"
}

# ── Rancher standalone — EC2 riêng chạy Rancher Server (Docker), NGOÀI cụm K8s.
#    Chỉ tạo khi chọn service "rancher" lúc tạo project (enable_rancher=true).
#    Quản lý cụm K8s từ xa qua kubeconfig (Rancher Import Cluster).
module "rancher" {
  source = "../../../modules/rancher"
  count  = var.enable_rancher ? 1 : 0

  project_name = var.project
  key_name     = var.key_name

  rancher_subnet_id = module.network.public_subnet_ids[0]
  vpc_id            = module.network.vpc_id
  instance_type     = "t3.medium"
  disk_size         = var.disk_size

  rancher_version           = var.rancher_version
  rancher_bootstrap_password = var.rancher_bootstrap_password
}

# ── NLB cho Ingress: trỏ thẳng vào node (ingress-nginx hostNetwork 80/443) ──
resource "aws_lb" "ingress" {
  name               = "${var.project}-${var.env}-nlb"
  internal           = false
  load_balancer_type = "network"
  subnets            = module.network.public_subnet_ids

  enable_deletion_protection = false
  tags                       = { Name = "${var.project}-${var.env}-nlb" }
}

resource "aws_lb_target_group" "ingress_http" {
  name     = "${var.project}-${var.env}-http"
  port     = 80
  protocol = "TCP"
  vpc_id   = module.network.vpc_id

  health_check {
    port     = "80"
    protocol = "HTTP"
    path     = "/healthz"
    matcher  = "200-399"
  }
  tags = { Name = "${var.project}-${var.env}-http" }
}

resource "aws_lb_target_group" "ingress_https" {
  name     = "${var.project}-${var.env}-https"
  port     = 443
  protocol = "TCP"
  vpc_id   = module.network.vpc_id

  health_check {
    port     = "80"
    protocol = "HTTP"
    path     = "/healthz"
    matcher  = "200-399"
  }
  tags = { Name = "${var.project}-${var.env}-https" }
}

# Gắn MỌI node vào target group (ingress-nginx chạy hostNetwork trên mọi node)
resource "aws_lb_target_group_attachment" "ingress_http" {
  count            = var.node_count
  target_group_arn = aws_lb_target_group.ingress_http.arn
  target_id        = module.kubernetes.node_instance_ids[count.index]
  port             = 80
}

resource "aws_lb_target_group_attachment" "ingress_https" {
  count            = var.node_count
  target_group_arn = aws_lb_target_group.ingress_https.arn
  target_id        = module.kubernetes.node_instance_ids[count.index]
  port             = 443
}

resource "aws_lb_listener" "ingress_http" {
  load_balancer_arn = aws_lb.ingress.arn
  port              = "80"
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.ingress_http.arn
  }
}

resource "aws_lb_listener" "ingress_https" {
  load_balancer_arn = aws_lb.ingress.arn
  port              = "443"
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.ingress_https.arn
  }
}

# ── Ansible: kubeadm init + join + Calico + cert-manager + ArgoCD ──
resource "null_resource" "ansible" {
  # Re-run Ansible nếu instance bị thay thế (IP đổi → inventory đổi)
  triggers = {
    instance_ids = join(",", module.kubernetes.node_instance_ids)
  }

  depends_on = [
    module.kubernetes,
    module.network,
    aws_lb.ingress,
    aws_lb_listener.ingress_http,
    aws_lb_listener.ingress_https,
  ]

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      KEY=~/.ssh/${var.key_name}.pem
      INVENTORY="${path.root}/../../../../ansible/inventories/${var.project}-${var.env}.ini"
      # Tất cả IP công khai (master) — worker private không SSH trực tiếp từ local
      NODES=$(grep -oP 'ansible_host=\K[0-9.]+' "$INVENTORY" | grep -v '^10\.' | sort -u)

      chmod 600 "$KEY"

      # Chờ TẤT CẢ node public SSH-ready (master) — như deploy-web
      echo ">>> Waiting for all public nodes to be SSH-ready..."
      FAILED=0
      for IP in $NODES; do
        echo "  Waiting for $IP:22 ..."
        SUCCESS=0
        for i in $(seq 1 30); do
          if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -i "$KEY" ubuntu@$IP "exit" 2>/dev/null; then
            SUCCESS=1
            break
          fi
          echo "    retry $i/30..."
          sleep 10
        done
        if [ "$SUCCESS" -eq 0 ]; then
          echo "  ERROR: $IP not reachable after 30 retries!"
          FAILED=1
        fi
      done
      if [ "$FAILED" -eq 1 ]; then
        echo ">>> Some nodes not reachable! Aborting."
        exit 1
      fi
      echo ">>> All nodes ready!"

      # BẮT BUỘC: khởi động ssh-agent + add key để ForwardAgent=yes hoạt động
      # (worker là private subnet, đi qua ProxyJump master — thiếu agent → Permission denied)
      echo ">>> Starting SSH agent..."
      eval $(ssh-agent -s)
      ssh-add "$KEY"

      echo ">>> Chạy Ansible (retry 3 lần, mỗi lần tối đa 15 phút)..."
      # cd vào đúng thư mục ansible/ để Ansible load group_vars/all.yml
      # (thiếu bước này → 'k8s_version' undefined)
      cd "$(dirname "$(dirname "$INVENTORY")")"
      for i in $(seq 1 3); do
        echo ">>> [Ansible attempt $i/3] BAT DAU - cum moi thuong mat 10-15 phut"
        if timeout 900 ansible-playbook -i inventories/${var.project}-${var.env}.ini \
            playbooks/k8s-cluster.yml -e project=${var.project} -e env=${var.env} \
            -e install_argocd=${var.enable_argocd}; then
          echo ">>> [Ansible attempt $i/3] THANH CONG"
          echo ">>> Ansible OK"
          exit 0
        fi
        echo "  Ansible attempt $i/3 FAILED, retry sau 30s..."
        sleep 30
      done
      echo ">>> Ansible failed sau 3 lần"
      exit 1
    EOT
  }
}

# ── Wait K8s API + refresh kubeconfig từ SSM (self-healing: cluster destroy/apply, IP đổi) ──
resource "terraform_data" "wait_k8s_api" {
  depends_on = [null_resource.ansible]

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      export KUBECONFIG="$HOME/.kube/config"
      SSM_NAME="/k8s/${var.project}-${var.env}/kubeconfig"
      for i in $(seq 1 30); do
        SSM_KUBECONFIG=$(aws ssm get-parameter --name "$SSM_NAME" \
          --with-decryption --region ${var.region} \
          --query Parameter.Value --output text 2>/dev/null || echo "")
        if [ -n "$SSM_KUBECONFIG" ]; then
          echo "$SSM_KUBECONFIG" | base64 -d | gunzip > "$HOME/.kube/config"
          chmod 600 "$HOME/.kube/config"
          if kubectl get ns >/dev/null 2>&1; then
            echo ">>> Kubeconfig OK (từ SSM $SSM_NAME)"
            exit 0
          fi
        fi
        echo "  chờ kubeconfig SSM (retry $i/30)..."
        sleep 10
      done
      echo ">>> Không lấy được kubeconfig từ SSM"
      exit 1
    EOT
  }
}

# ── Kubernetes + Helm provider (dùng sau khi cluster sẵn sàng) ──
provider "kubernetes" {
  config_path = pathexpand("~/.kube/config")
}
provider "helm" {
  kubernetes = {
    config_path = pathexpand("~/.kube/config")
  }
}

# ── Cài platform components dùng chung (mọi app đều cần) ──
#   ingress-nginx + kube-prometheus-stack (Prometheus/Grafana) + metrics-server
#   (HPA) + aws-ebs-csi-driver (StorageClass EBS) + argo-rollouts.
#   Cài chart helm/_cluster — helm upgrade idempotent, self-heal mỗi lần apply.
resource "terraform_data" "install_cluster_base" {
  depends_on = [terraform_data.wait_k8s_api]

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      export KUBECONFIG="$HOME/.kube/config"
      cd "${path.root}/../../../.."
      helm upgrade --install cluster-base helm/_cluster \
        -n kube-system --create-namespace \
        --wait --timeout 20m
      echo ">>> Cluster base OK: ingress-nginx + prometheus/grafana + metrics-server + ebs-csi + argo-rollouts"
    EOT
  }
}
