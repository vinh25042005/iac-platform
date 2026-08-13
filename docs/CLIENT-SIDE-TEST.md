# Client-side test — CICD-AIO-Jenkins.groovy (chuẩn bị sẵn)

> Trạng thái: **CẦN tạo DC cluster mới** (bạn chưa chốt tên project). Toàn bộ bước dưới đây sẽ
> chạy sau khi có cluster. Company CI đã test xong (build 6–10 SUCCESS, xem `docs/screenshots/README.md`).

## 1. Quy ước tên (lấy từ `getNamingContext()` trong pipeline)

Với `PROJECT_NAME=techshop`, `ENVIRONMENT=dev`, `PATH_NAME=` (rỗng):

| Object | Tên |
|--------|-----|
| Namespace | `techshop-dev-ns` |
| Deployment | `techshop-dev-deployment` |
| Container (trong deployment) | `techshop-dev-container` |
| Unit-test deployment | `techshop-dev-unit-test-deployment` |
| Unit-test pod label | `app=techshop-dev-unit-test-app` |

Nếu có `PATH_NAME=<path>` thì prefix `<path>-` được thêm vào trước: `<path>-techshop-dev-ns`, ...

Lệnh deploy pipeline dùng:
```bash
kubectl --kubeconfig kube-config --insecure-skip-tls-verify -n <ns> \
  set image deployment.apps/<deployment> <container>=<IMAGETAG>
```

## 2. Việc cần làm trên DC cluster (sau khi tạo xong)

```bash
# Namespace
kubectl create ns techshop-dev-ns

# ImagePullSecret cho registry.gitlab.com (để k8s pull được image)
kubectl -n techshop-dev-ns create secret docker-registry gitlab-regcred \
  --docker-server=registry.gitlab.com \
  --docker-username=<GITLAB_USER> \
  --docker-password=<GITLAB_PAT>

# Deployment sẵn (container tên techshop-dev-container) — mẫu:
cat <<'EOF' | kubectl -n techshop-dev-ns apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: techshop-dev-deployment
  namespace: techshop-dev-ns
spec:
  replicas: 1
  selector:
    matchLabels: { app: techshop-dev-deployment }
  template:
    metadata:
      labels: { app: techshop-dev-deployment }
    spec:
      imagePullSecrets:
        - name: gitlab-regcred
      containers:
        - name: techshop-dev-container
          image: registry.gitlab.com/vinh25042005/techshop-app/techshop:dev-6
          imagePullPolicy: IfNotPresent
EOF
```

Lấy kubeconfig của cluster → tạo **Jenkins credential loại "Secret file"** (id tuỳ chọn, VD `dc-kubeconfig`).

## 3. Client Vault (DC) — chuẩn bị secret

Pipeline đọc client secrets từ `DC_VAULT_ADDR`/`DC_VAULT_TOKEN`, path `VAULT_PATH=secret/techshop`
(giống company). Cần 2 key (mặc định `CLIENT_SECRET_VAULT=["ENV_FILE","CONFIG_ENV"]`):

```bash
export VAULT_ADDR=https://<DC_VAULT_ADDR> VAULT_TOKEN=<token>
vault kv put secret/techshop \
  ENV_FILE="<nội dung env cho app>" \
  CONFIG_ENV="<nội dung config env>" \
  sit.js="<file cấu hình sit>" configEnv.js="<file config>"
```
(Các key tương ứng `CLIENT_LOCATION_VAULT=["sit.js","configEnv.js"]`.)

## 4. Jenkins params để trigger build client-side (deploy lên DC)

Khi đã có cluster + kubeconfig credential + client Vault, trigger `all_in_one` với:
```
PROJECT_NAME=techshop
ENVIRONMENT=dev
LOCATION=company-side            # (hoặc client-side — pipeline dùng CLIENT_* cho client)
SOURCE_CODE_PATH=vinh25042005/techshop-app
BRANCH_CODE=main
GITLAB_ACCESS_TOKEN=gitlab-token
REGISTRY_URL=registry.gitlab.com/vinh25042005
REGISTRY_AUTH=gitlab-registry-auth
COMPANY_VAULT_ADDR=https://52.221.18.86:8200
COMPANY_VAULT_TOKEN=vault-token
VAULT_PATH=secret/techshop
REPOSITORY_NAME=techshop-app
ENABLED_STAGES=["CheckSource","company-get-vault","build-push","trigger-cd"]

# --- Client-side ---
IMAGETAG=registry.gitlab.com/vinh25042005/techshop-app/techshop:dev-6
CLIENT_LOCATION=client-side
CLIENT_ENV_ACTION=client-deploy
CLIENT_ENABLED_STAGES=["secret-dc","unit-test-dc","deploy-dc","configure-dc"]
CLIENT_SECRET_VAULT=["ENV_FILE","CONFIG_ENV"]
CLIENT_SECRET_NAME=["env-file-secret","config-env-secret"]
CLIENT_LOCATION_VAULT=["sit.js","configEnv.js"]
DC_VAULT_ADDR=<dc-vault-addr>
DC_VAULT_TOKEN=<dc-vault-token credential id>
DC_KUBE_CONFIG_FILE=<credential id Secret file chứa kubeconfig DC>
```

## 5. Ghi chú về các stage client

- `Apply Secrets` cần `CLIENT_ENABLED_STAGES` chứa `secret-dc`/`secret-dr`.
- `Unit Test before deploy` cần `unit-test-dc`/`unit-test-dr` — tạo deployment unit-test
  (`techshop-dev-unit-test-deployment`) + chạy test trên pod, xem `runUnitTestsOnPod()`.
- `Deploy to Cluster` cần `deploy-dc`/`deploy-dr`/`deploy-erp` — chạy `kubectl set image`.
- `Apply configure to DC and DR` cần `configure-dc`/`configure-dr`.
- `Trigger DC and DR deploy` cần `CLIENT_ENV_ACTION=client-trigger` + `trigger-dc`/`trigger-dr`.
- DR (disaster recovery) = cluster thứ 2, dùng `DR_*` params tương tự.

## 6. Bước tạo DC cluster (chờ chốt tên project)

```
./scripts/new-project.sh <project-name>   # nhập registry = registry.gitlab.com, repo = techshop-app
cd terraform/environments/<project-name>/<env>
terraform init && terraform apply -auto-approve   # tạo EKS/DC cluster + Rancher import
```
Sau đó cài kubeconfig vào Jenkins (Secret file credential), tạo namespace/deployment/imagePullSecret như mục 2.
