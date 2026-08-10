project = "bnf"
env     = "prd"
region  = "ap-southeast-1"

# ── Cụm kubeadm (sửa theo ý bạn) ──
key_name      = "bnf-key"   # ← AWS key pair đã tạo
instance_type = "t3.small"
node_count    = 3                # ← điền số node (1 master + N-1 worker)
