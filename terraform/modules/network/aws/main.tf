# Module network (AWS) — VPC 2 tầng public/private + NAT + Security Groups
#   - project/env xác định tên resource
#   - count/list thay vì resource tách a/b
#   - SG dùng dynamic block + CIDR giới hạn (least privilege)
terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

# ── VPC ──
resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${var.project}-${var.env}-vpc" }
}

# ── Subnets PUBLIC (tự gán public IP — chứa bastion / ingress / NAT) ──
resource "aws_subnet" "public" {
  count                   = length(var.public_subnets)
  vpc_id                  = aws_vpc.this.id
  cidr_block              = var.public_subnets[count.index]
  availability_zone       = var.azs[count.index % length(var.azs)]
  map_public_ip_on_launch = true
  tags                    = { Name = "${var.project}-${var.env}-public-${count.index}" }
}

# ── Subnets PRIVATE (node K8s / DB — không có public IP, ra internet qua NAT) ──
resource "aws_subnet" "private" {
  count             = length(var.private_subnets)
  vpc_id            = aws_vpc.this.id
  cidr_block        = var.private_subnets[count.index]
  availability_zone = var.azs[count.index % length(var.azs)]
  tags              = { Name = "${var.project}-${var.env}-private-${count.index}" }
}

# ── Internet Gateway ──
resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.project}-${var.env}-igw" }
}

# ── NAT Gateway (private ra internet) — 1 cái duy nhất để tiết kiệm chi phí ──
resource "aws_eip" "nat" {
  count  = var.enable_nat ? 1 : 0
  domain = "vpc"
}

resource "aws_nat_gateway" "this" {
  count         = var.enable_nat ? 1 : 0
  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id
  tags          = { Name = "${var.project}-${var.env}-nat" }
}

# ── Route table PUBLIC → IGW ──
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = { Name = "${var.project}-${var.env}-public-rt" }
}

resource "aws_route_table_association" "public" {
  count          = length(var.public_subnets)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# ── Route table PRIVATE → NAT ──
resource "aws_route_table" "private" {
  count  = var.enable_nat ? 1 : 0
  vpc_id = aws_vpc.this.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this[0].id
  }
  tags = { Name = "${var.project}-${var.env}-private-rt" }
}

resource "aws_route_table_association" "private" {
  count          = length(var.private_subnets)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[0].id
}

# ── Security Groups ──
# allow_internal: traffic nội bộ giữa các node + SSH từ CIDR được phép (bastion/VPN)
resource "aws_security_group" "allow_internal" {
  name        = "${var.project}-${var.env}-allow-internal"
  description = "Allow all internal traffic + SSH between nodes"
  vpc_id      = aws_vpc.this.id

  ingress {
    from_port = 0
    to_port   = 0
    protocol  = "-1"
    self      = true
  }

  # SSH chỉ từ CIDR được khai báo (bastion / VPN) — KHÔNG mở 22 ra 0.0.0.0/0
  dynamic "ingress" {
    for_each = toset(var.allowed_ssh_cidrs)
    content {
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "${var.project}-${var.env}-allow-internal" }
}

# allow_api: K8s API (6443) + Rancher (8443) + HTTPS từ CIDR admin
resource "aws_security_group" "allow_api" {
  name        = "${var.project}-${var.env}-allow-api"
  description = "Allow K8s API + Rancher from internet"
  vpc_id      = aws_vpc.this.id

  dynamic "ingress" {
    for_each = length(var.allowed_api_cidrs) > 0 ? toset([443, 8443, 6443]) : toset([])
    content {
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = var.allowed_api_cidrs
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "${var.project}-${var.env}-allow-api" }
}

# allow_web: HTTP/HTTPS tới ingress nodes (web public)
resource "aws_security_group" "allow_web" {
  name        = "${var.project}-${var.env}-allow-web"
  description = "Allow HTTP/HTTPS from internet to ingress nodes"
  vpc_id      = aws_vpc.this.id

  dynamic "ingress" {
    for_each = length(var.allowed_web_cidrs) > 0 ? toset([80, 443]) : toset([])
    content {
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = var.allowed_web_cidrs
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "${var.project}-${var.env}-allow-web" }
}
