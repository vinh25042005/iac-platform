# Truy cập các giao diện hệ thống

## 1. Backstage Portal
- **URL:** http://localhost:3005
- **Backend:** http://localhost:7007
- **Khởi động:** `./scripts/portal.sh start` (tự dựng SSH tunnel Jenkins)
- **Đăng nhập:** Guest (bấm Sign In → Guest)

## 2. Jenkins
- **URL:** http://localhost:9090 (qua SSH tunnel)
- **Khởi động tunnel:** `./scripts/start-jenkins-tunnel.sh start`
- **Tài khoản:** `admin` — token lấy bằng lệnh:
  ```bash
  grep -E 'JENKINS_(USER|TOKEN)=' scripts/portal.env
  ```

## 3. Vault
- **URL:** https://52.221.18.86:8200
- **Token đăng nhập** — lấy bằng lệnh:
  ```bash
  grep 'VAULT_TOKEN=' scripts/portal.env
  ```
- **Lưu ý:** cert tự ký → trình duyệt bấm bỏ qua cảnh báo

## 4. Rancher
- **URL:** https://47.130.131.244 (project test123)
- **Tài khoản:** `admin` / `admin`
- **Nếu quên mật khẩu**, reset bằng lệnh:
  ```bash
  # 1. Tạm mở SSH 22 trên SG rancher từ IP hiện tại
  MYIP=$(curl -s https://api.ipify.org)
  aws ec2 authorize-security-group-ingress --group-id <SG-rancher> --protocol tcp --port 22 --cidr "$MYIP/32"
  # 2. SSH vào, tìm user admin + băm bcrypt password mới (python bcrypt), patch cả 2 field
  ssh -i ~/.ssh/techshop-key.pem ubuntu@47.130.131.244
  docker exec rancher kubectl --kubeconfig /var/lib/rancher/k3s/server/cred/admin.kubeconfig get users -A | grep admin
  # 3. Đóng SSH 22
  aws ec2 revoke-security-group-ingress --group-id <SG-rancher> --protocol tcp --port 22 --cidr "$MYIP/32"
  ```
- **Lưu ý:** cert tự ký → bỏ qua cảnh báo trình duyệt; cluster import `c-dnc6x` (test123-dev) đã Active

## 5. Grafana
- **Port-forward:**
  ```bash
  KUBECONFIG=/tmp/kube-test123.yaml kubectl port-forward -n kube-system svc/cluster-base-grafana 3000:80
  ```
  → **URL:** http://localhost:3000
- **Tài khoản:** `admin` — password lấy bằng lệnh:
  ```bash
  KUBECONFIG=/tmp/kube-test123.yaml kubectl get secret -n kube-system cluster-base-grafana -o jsonpath='{.data.admin-password}' | base64 -d
  ```

## 6. Prometheus
- **Port-forward:**
  ```bash
    KUBECONFIG=/tmp/kube-test123.yaml kubectl port-forward -n kube-system svc/cluster-base-kube-promethe-prometheus 9090:9090

  ```
  → **URL:** http://localhost:9090

## 7. ArgoCD
- **Port-forward:**
  ```bash
  KUBECONFIG=/tmp/kube-test123.yaml kubectl port-forward -n argocd svc/argocd-server 8080:80
  ```
  → **URL:** http://localhost:8080
- **Tài khoản:** `admin` — password lấy bằng lệnh:
  ```bash
  KUBECONFIG=/tmp/kube-test123.yaml kubectl get secret -n argocd argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d
  ```

## Ghi chú chung
- Kubeconfig cluster: lấy từ SSM `/k8s/test123-dev/kubeconfig` (giải nén gzip+base64)
- Các UI trong cluster (Grafana/Prometheus/ArgoCD) truy cập bằng **port-forward** vì chưa có ingress; muốn truy cập qua domain thì cấu hình host trong `helm/_base/values/<project>/values.yaml` (`ingress.host`, `monitoring.grafanaHost`) rồi sync.
