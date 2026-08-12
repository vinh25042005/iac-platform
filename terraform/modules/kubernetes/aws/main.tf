# Module kubernetes (AWS) — kubeadm self-managed cluster
#   node[0] = master (public subnet, có public IP — kubeadm init + NLB upstream)
#   node[1..] = workers (private subnet, qua NAT ra internet, join qua SSM)
#   Kubeconfig + join commands upload lên SSM (prefix /k8s/<project>-<env>/)
terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

# ── AMI Ubuntu 22.04 (Canonical) ──
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
}

# ── IAM Role cho node: SSM Session Manager + EBS CSI + S3 backup + KMS ──
data "aws_iam_policy_document" "ec2_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "node_ssm" {
  name               = "${var.project}-${var.env}-node-ssm-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_trust.json
}

resource "aws_iam_role_policy_attachment" "node_ssm" {
  role       = aws_iam_role.node_ssm.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Inline policy: SSM (per project-env prefix) + EBS (CSI driver) + S3 backup + KMS
resource "aws_iam_role_policy" "node_ssm_params" {
  name = "${var.project}-${var.env}-ssm-params"
  role = aws_iam_role.node_ssm.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ssm:PutParameter", "ssm:GetParameter", "ssm:GetParametersByPath", "ssm:DeleteParameter"]
        Resource = "arn:aws:ssm:${var.region}:*:parameter/k8s/${var.project}-${var.env}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "ec2:CreateVolume", "ec2:DeleteVolume", "ec2:DescribeVolumes",
          "ec2:AttachVolume", "ec2:DetachVolume", "ec2:DescribeInstances",
          "ec2:CreateTags", "ec2:DescribeTags", "ec2:DescribeAvailabilityZones",
          "ec2:DescribeSnapshots"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = ["s3:ListBucket", "s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = [
          "arn:aws:s3:::${var.backup_bucket_name}",
          "arn:aws:s3:::${var.backup_bucket_name}/*"
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Encrypt", "kms:Decrypt", "kms:DescribeKey", "kms:GenerateDataKey"]
        Resource = "arn:aws:kms:${var.region}:*:key/*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "node_ssm" {
  name = "${var.project}-${var.env}-node-ssm-profile"
  role = aws_iam_role.node_ssm.name
}

# ── Node[master_node_index] = master (public subnet, public IP);
#    các node còn lại = workers (private subnet, qua NAT ra internet) ──
# Worker thứ w (w = số thứ tự trong danh sách worker, bỏ qua node master) → private subnet.
resource "aws_instance" "node" {
  count                  = var.node_count
  ami                    = data.aws_ami.ubuntu.id
  iam_instance_profile   = aws_iam_instance_profile.node_ssm.name
  instance_type          = var.instance_type
  subnet_id              = count.index == var.master_node_index ? var.public_subnet_id : var.private_subnet_ids[(count.index < var.master_node_index ? count.index : count.index - 1) % length(var.private_subnet_ids)]
  vpc_security_group_ids = var.sg_ids
  key_name               = var.key_name

  root_block_device {
    volume_size = var.disk_size
    volume_type = "gp3"
  }

  # K8s cài qua Ansible (không dùng user_data)
  tags = {
    Name = count.index == var.master_node_index ? "${var.project}-${var.env}-master" : "${var.project}-${var.env}-worker-${count.index}"
    Role = count.index == var.master_node_index ? "master" : "worker"
  }
}

# ── Generate Ansible inventory (INI format) ──
#   master: public IP trực tiếp (node[master_node_index])
#   workers: các node còn lại (private IP, qua ProxyJump bastion = master public IP)
resource "local_file" "ansible_inventory" {
  content = templatefile("${path.module}/inventory.tpl", {
    project   = var.project
    env       = var.env
    master_ip = aws_instance.node[var.master_node_index].public_ip
    worker_hosts = [
      for i in range(0, var.node_count) :
      {
        name       = i == var.master_node_index ? "${var.project}-${var.env}-master" : "${var.project}-${var.env}-worker-${i}"
        private_ip = aws_instance.node[i].private_ip
        bastion    = aws_instance.node[var.master_node_index].public_ip
      }
      if i != var.master_node_index
    ]
    key_file = "~/.ssh/${var.key_name}.pem"
  })
  filename = var.inventory_path
}
