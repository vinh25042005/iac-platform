# Hướng dẫn tự chạy lại pipeline `CICD-AIO-Jenkins.groovy` (từng bước)

> Tài liệu này ghi lại **chính xác các bước đã chạy thành công**, kèm từng param, credential
> của từng trường hợp, để tự chạy lại và hiểu luồng.
> File pipeline `CICD-AIO-Jenkins.groovy` **KHÔNG được sửa** — chỉ điền param khi trigger.

---

## 0. Tổng quan kiến trúc

```
[GitLab] techshop-app (backend/frontend)
    │  git clone
    ▼
[Jenkins all_in_one job]  ← Pipeline from SCM → CICD-AIO-Jenkins.groovy (GitHub iac-platform, main)
    │  đọc secrets từ [Vault] secret/techshop (DOCKER_FILE, GRUNTFILE, ENV_FILE, CONFIG_ENV...)
    │  build image → push [GitLab Registry] registry.gitlab.com/vinh25042005/...
    │  (nếu client-deploy) đọc kubeconfig từ credential → kubectl deploy thẳng [Cluster K8s] (KHÔNG ArgoCD)
    └── trigger [client-sink job] (nếu bật trigger-cd)
```

**Quy ước naming (pipeline tự đặt, dựa trên `PROJECT_NAME` + `ENVIRONMENT`):**

| Thứ | Công thức | Ví dụ (`techshop` + `dev`) |
|---|---|---|
| Namespace | `<project>-<env>-ns` | `techshop-dev-ns` |
| Deployment | `<project>-<env>-deployment` | `techshop-dev-deployment` |
| Container | `<project>-<env>-container` | `techshop-dev-container` |
| Đường dẫn secret file | `<project>-<env>/<key>` | `techshop-dev/sit.js` |

> ⚠️ Pipeline chỉ **set image** (`kubectl set image deployment/... container=image`) nên
> **deployment phải tồn tại sẵn** trong cluster trước khi chạy CD (xem mục 7).

---

## 1. Chuẩn bị môi trường (làm 1 lần)

### 1.1 Kết nối tới Jenkins qua SSH tunnel

Jenkins chạy docker trên EC2 `techshop-jenkins` (47.130.241.226), UI nằm sau tunnel:

```bash
# Mở 1 terminal riêng, giữ chạy nền:
ssh -i ~/.ssh/techshop-key.pem -N -L 9090:localhost:9090 ubuntu@47.130.241.226
```

- UI: http://localhost:9090 → đăng nhập `admin` (pass xem mật khẩu đã cấu hình).
- API/curl: dùng `-u admin:<JENKINS_TOKEN>` (token lấy từ `scripts/portal.env`).

### 1.2 Nạp biến môi trường

```bash
cd /home/vinh2/iac-platform
source scripts/portal.env    # JENKINS_USER, JENKINS_TOKEN, VAULT_TOKEN
source scripts/cicd-test.env # GITLAB_TOKEN, VAULT_TOKEN, VAULT_ADDR, ...
```

> ⚠️ Cả 2 file này nằm trong `.gitignore` (không commit, không dán secret vào chat).

### 1.3 Mẹo curl (rất quan trọng)

URL Jenkins có ký tự `[ ]` → curl tưởng là "range" → lỗi `bad range in URL`.
**Luôn thêm** `-g` (globoff) và `--noproxy '*'`:

```bash
curl -s -g --noproxy '*' -u "admin:$JENKINS_TOKEN" \
  "http://127.0.0.1:9090/job/all_in_one/api/json?tree=nextBuildNumber" | jq
```

---

## 2. Credentials trong Jenkins (dùng cho param nào)

> **Điểm mấu chốt:** các param `GITLAB_ACCESS_TOKEN`, `REGISTRY_AUTH`, `*_VAULT_TOKEN`,
> `DC_KUBE_CONFIG_FILE` **nhận CREDENTIAL ID** (tên credential), KHÔNG phải giá trị secret.
> Pipeline tự `withCredentials` đọc ra.

| Credential ID | Loại | Param nhận | Dùng trong kịch bản |
|---|---|---|---|
| `gitlab-token` | Secret text (GitLab PAT) | `GITLAB_ACCESS_TOKEN` | CI |
| `gitlab-registry-auth` | Secret file (docker config registry.gitlab.com) | `REGISTRY_AUTH` | CI |
| `vault-token` | Secret text (Vault token) | `COMPANY_VAULT_TOKEN` (CI) / `DC_VAULT_TOKEN` (CD) | CI + CD |
| `dc-kubeconfig` | Secret file (kubeconfig cụm `dc-dev`) | `DC_KUBE_CONFIG_FILE` | CD lên cụm dc |
| `demo-kubeconfig` | Secret file (kubeconfig cụm `demo-dev`) | `DC_KUBE_CONFIG_FILE` | CD lên cụm demo |
| `jenkins-client-user` | Secret text (`admin`) | `JENKINS_CLIENT_USER` | trigger client-sink |
| `jenkins-client-token` | Secret text (API token) | `JENKINS_CLIENT_TOKEN` | trigger client-sink |

> Cách tạo credential file (kubeconfig): **Manage Jenkins → Credentials → System → Global →
> Add Credentials → Kind = Secret file → Upload kubeconfig → ID = `demo-kubeconfig` → Create**.
> (Xem mục 7.3 cách lấy kubeconfig từ Vault về máy.)

---

## 3. Các param chính (giải thích ngắn)

| Param | Ý nghĩa | Ví dụ |
|---|---|---|
| `PROJECT_NAME` | Tên project → đặt tên ns/deployment/container | `techshop` |
| `ENVIRONMENT` | Môi trường | `dev` / `sit` / `uat` / `prd` |
| `LOCATION` | `company-side` = bật khối CI company | `company-side` |
| `SOURCE_CODE_PATH` | Repo GitLab | `vinh25042005/techshop-app` |
| `BRANCH_CODE` | Branch checkout/build | `main` |
| `REGISTRY_URL` | Nơi push image | `registry.gitlab.com/vinh25042005` |
| `VAULT_PATH` | Path Vault KV v2 | `secret/techshop` |
| `ENABLED_STAGES` | Bật stage **company** (JSON array) | `["CheckSource","company-get-vault","build-push"]` |
| `COMPANY_SECRET_VAULT` | Keys lấy từ Vault (company) | `["DOCKER_FILE","GRUNTFILE"]` |
| `COMPANY_LOCATION_VAULT` | Tên file ghi ra tương ứng | `["Dockerfile","Gruntfile.js"]` |
| `IMAGETAG` | Full image tag deploy (CD) | `registry.gitlab.com/.../techshop:dev-28` |
| `CLIENT_LOCATION` | `client-side` = bật khối client | `client-side` |
| `CLIENT_ENV_ACTION` | `client-deploy` hoặc `client-trigger` | `client-deploy` |
| `CLIENT_ENABLED_STAGES` | Bật stage **client** | `["get-vault-dc","secret-dc","deploy-dc"]` |
| `CLIENT_SECRET_VAULT` | Keys lấy từ Vault (client) | `["ENV_FILE","CONFIG_ENV"]` |
| `CLIENT_SECRET_NAME` | Tên k8s secret tạo ra | `["env-file-secret","config-env-secret"]` |
| `CLIENT_LOCATION_VAULT` | Tên file ghi ra (client) | `["sit.js","configEnv.js"]` |
| `DC_KUBE_CONFIG_FILE` | Credential kubeconfig cụm | `demo-kubeconfig` |
| `JENKINS_CLIENT_*` | Trigger CD client | `http://localhost:8080/job/client-sink`, `jenkins-client-user`, `jenkins-client-token` |

---

## 4. Cách trigger build (2 cách)

**Cách 1 — UI:** Jenkins → job `all_in_one` → **Build with Parameters** → điền → **Build**.

**Cách 2 — API (dùng cho script):**
```bash
source scripts/portal.env
curl -s -g --noproxy '*' -u "admin:$JENKINS_TOKEN" -X POST \
  "http://127.0.0.1:9090/job/all_in_one/buildWithParameters" \
  --data-urlencode 'PROJECT_NAME=techshop' \
  --data-urlencode 'ENVIRONMENT=dev' \
  ...  # mỗi param 1 --data-urlencode
```

> `buildWithParameters` trả HTTP `201` khi đã nhận. Build số = `nextBuildNumber` trước khi trigger.

---

## 5. Kịch bản A — Company CI (chỉ build + push image)

**Mục đích:** khách cần image trong registry, KHÔNG deploy.

**Credentials cần:** `gitlab-token`, `gitlab-registry-auth`, `vault-token`.

**Params (bỏ trống hết `CLIENT_*` / `DC_*`):**

| Param | Giá trị |
|---|---|
| `PROJECT_NAME` | `techshop` |
| `ENVIRONMENT` | `dev` |
| `LOCATION` | `company-side` |
| `SOURCE_CODE_PATH` | `vinh25042005/techshop-app` |
| `BRANCH_CODE` | `main` |
| `GITLAB_ACCESS_TOKEN` | `gitlab-token` ← credential ID |
| `REGISTRY_URL` | `registry.gitlab.com/vinh25042005` |
| `REGISTRY_AUTH` | `gitlab-registry-auth` ← credential ID |
| `COMPANY_VAULT_ADDR` | `https://52.221.18.86:8200` |
| `COMPANY_VAULT_TOKEN` | `vault-token` ← credential ID |
| `VAULT_PATH` | `secret/techshop` |
| `REPOSITORY_NAME` | `techshop-app` |
| `ENABLED_STAGES` | `["CheckSource","company-get-vault","build-push"]` |
| `COMPANY_SECRET_VAULT` | `["DOCKER_FILE","GRUNTFILE"]` |
| `COMPANY_LOCATION_VAULT` | `["Dockerfile","Gruntfile.js"]` |
| `TEAMS_WEBHOOK_URL` | (bỏ trống) |

**Lệnh trigger đầy đủ:**
```bash
source scripts/portal.env
curl -s -g --noproxy '*' -u "admin:$JENKINS_TOKEN" -X POST \
  "http://127.0.0.1:9090/job/all_in_one/buildWithParameters" \
  --data-urlencode 'PROJECT_NAME=techshop' --data-urlencode 'ENVIRONMENT=dev' \
  --data-urlencode 'LOCATION=company-side' \
  --data-urlencode 'SOURCE_CODE_PATH=vinh25042005/techshop-app' --data-urlencode 'BRANCH_CODE=main' \
  --data-urlencode 'GITLAB_ACCESS_TOKEN=gitlab-token' \
  --data-urlencode 'REGISTRY_URL=registry.gitlab.com/vinh25042005' --data-urlencode 'REGISTRY_AUTH=gitlab-registry-auth' \
  --data-urlencode 'COMPANY_VAULT_ADDR=https://52.221.18.86:8200' --data-urlencode 'COMPANY_VAULT_TOKEN=vault-token' \
  --data-urlencode 'VAULT_PATH=secret/techshop' --data-urlencode 'REPOSITORY_NAME=techshop-app' \
  --data-urlencode 'ENABLED_STAGES=["CheckSource","company-get-vault","build-push"]' \
  --data-urlencode 'COMPANY_SECRET_VAULT=["DOCKER_FILE","GRUNTFILE"]' \
  --data-urlencode 'COMPANY_LOCATION_VAULT=["Dockerfile","Gruntfile.js"]' \
  -o /dev/null -w 'HTTP %{http_code}\n'   # 201 = đã nhận
```

**Verify:** console có `naming to registry.gitlab.com/.../techshop:dev-<số-build> done`,
`Build and push image success`, `Finished: SUCCESS`. Ảnh tham chiếu: `docs/screenshots/demo-ci-*`.

---

## 6. Kịch bản B — Client CD (deploy image lên cluster K8s trần — KHÔNG ArgoCD)

**Mục đích:** deploy image ĐÃ CÓ sẵn lên cluster (không build). Đây là luồng mới
(kubeconfig lấy từ **Vault**, deploy bằng `kubectl` trực tiếp, không ArgoCD).

**Credentials cần:** `vault-token` (cho `DC_VAULT_TOKEN`), `demo-kubeconfig` hoặc `dc-kubeconfig`
(cho `DC_KUBE_CONFIG_FILE`).

**Params:**

| Param | Giá trị |
|---|---|
| `IMAGETAG` | `registry.gitlab.com/vinh25042005/techshop-app/techshop:dev-28` ← image đã build |
| `PROJECT_NAME` | `techshop` |
| `ENVIRONMENT` | `dev` |
| `LOCATION` | `company-side` |
| `SOURCE_CODE_PATH` | `vinh25042005/techshop-app` |
| `BRANCH_CODE` | `main` |
| `GITLAB_ACCESS_TOKEN` | `gitlab-token` |
| `VAULT_PATH` | `secret/techshop` ← **BẮT BUỘC** (thiếu → lỗi `vault kv get ... Not enough arguments`) |
| `ENABLED_STAGES` | `["CheckSource"]` ← chỉ checkout, không build |
| `CLIENT_LOCATION` | `client-side` |
| `CLIENT_ENV_ACTION` | `client-deploy` |
| `CLIENT_ENABLED_STAGES` | `["get-vault-dc","secret-dc","deploy-dc"]` |
| `CLIENT_SECRET_VAULT` | `["ENV_FILE","CONFIG_ENV"]` |
| `CLIENT_SECRET_NAME` | `["env-file-secret","config-env-secret"]` |
| `CLIENT_LOCATION_VAULT` | `["sit.js","configEnv.js"]` |
| `DC_VAULT_ADDR` | `https://52.221.18.86:8200` |
| `DC_VAULT_TOKEN` | `vault-token` ← credential ID |
| `DC_KUBE_CONFIG_FILE` | `demo-kubeconfig` ← credential ID cụm đích |

**Lệnh trigger đầy đủ:**
```bash
source scripts/portal.env
curl -s -g --noproxy '*' -u "admin:$JENKINS_TOKEN" -X POST \
  "http://127.0.0.1:9090/job/all_in_one/buildWithParameters" \
  --data-urlencode 'IMAGETAG=registry.gitlab.com/vinh25042005/techshop-app/techshop:dev-28' \
  --data-urlencode 'PROJECT_NAME=techshop' --data-urlencode 'ENVIRONMENT=dev' \
  --data-urlencode 'REPOSITORY_NAME=techshop-app' --data-urlencode 'LOCATION=company-side' \
  --data-urlencode 'SOURCE_CODE_PATH=vinh25042005/techshop-app' --data-urlencode 'BRANCH_CODE=main' \
  --data-urlencode 'GITLAB_ACCESS_TOKEN=gitlab-token' \
  --data-urlencode 'VAULT_PATH=secret/techshop' \
  --data-urlencode 'ENABLED_STAGES=["CheckSource"]' \
  --data-urlencode 'CLIENT_LOCATION=client-side' --data-urlencode 'CLIENT_ENV_ACTION=client-deploy' \
  --data-urlencode 'CLIENT_ENABLED_STAGES=["get-vault-dc","secret-dc","deploy-dc"]' \
  --data-urlencode 'CLIENT_SECRET_VAULT=["ENV_FILE","CONFIG_ENV"]' \
  --data-urlencode 'CLIENT_SECRET_NAME=["env-file-secret","config-env-secret"]' \
  --data-urlencode 'CLIENT_LOCATION_VAULT=["sit.js","configEnv.js"]' \
  --data-urlencode 'DC_VAULT_ADDR=https://52.221.18.86:8200' --data-urlencode 'DC_VAULT_TOKEN=vault-token' \
  --data-urlencode 'DC_KUBE_CONFIG_FILE=demo-kubeconfig' \
  -o /dev/null -w 'HTTP %{http_code}\n'
```

**Verify:** console có `secret/env-file-secret created`, `secret/config-env-secret created`,
`deployment "techshop-dev-deployment" successfully rolled out`, `Finished: SUCCESS`.
Ảnh tham chiếu: `docs/screenshots/demo-cd-*`.

---

## 7. Chuẩn bị cluster & kubeconfig (làm trước khi chạy CD lần đầu)

### 7.1 Tạo project mới (nếu chưa có)

```bash
cd /home/vinh2/iac-platform
ENVS=dev KEY_NAME=techshop-key INSTANCE_TYPE=t3.medium NODE_COUNT=3 \
ENABLE_ARGOCD=false \
VAULT_ADDR=https://52.221.18.86:8200 VAULT_TOKEN=<VAULT_TOKEN từ cicd-test.env> \
./scripts/new-project.sh demo
```
- `ENABLE_ARGOCD=false` → cluster K8s trần (không tạo ArgoCD app).
- Script tự ghi `vault_addr` / `vault_token` / `enable_argocd` vào `terraform.tfvars`.

### 7.2 Terraform apply (tạo cụm + Ansible push kubeconfig lên Vault)

```bash
cd terraform/environments/demo/dev
terraform init -input=false
terraform validate
terraform apply -auto-approve -input=false   # ~15-20 phút
```
- Ansible (master role) sau khi `kubeadm init` **tự push kubeconfig lên Vault** `secret/k8s/demo-dev`.

### 7.3 Lấy kubeconfig từ Vault & verify cụm

```bash
source scripts/cicd-test.env
curl -sk -H "X-Vault-Token: $VAULT_TOKEN" \
  "$VAULT_ADDR/v1/secret/data/k8s/demo-dev" | jq -r '.data.data.kubeconfig' > /tmp/demo-kubeconfig
chmod 600 /tmp/demo-kubeconfig
kubectl --kubeconfig /tmp/demo-kubeconfig get nodes   # mong đợi 3 Ready
kubectl --kubeconfig /tmp/demo-kubeconfig get ns | grep -i argocd   # KHÔNG có → đúng yêu cầu
```

### 7.4 Tạo credential `demo-kubeconfig` trong Jenkins

Tải file `/tmp/demo-kubeconfig` lên làm **Secret file** credential ID `demo-kubeconfig`
(Manage Jenkins → Credentials → System → Global → Add Credentials → Secret file → Create).

### 7.5 Tạo deployment TRƯỚC (pipeline chỉ `kubectl set image`)

```bash
cat > /tmp/app.yaml <<'YAML'
apiVersion: v1
kind: Namespace
metadata:
  name: techshop-dev-ns
---
apiVersion: v1
kind: Secret
metadata:
  name: gitlab-regcred
  namespace: techshop-dev-ns
type: kubernetes.io/dockerconfigjson
data:
  .dockerconfigjson: <base64 của docker config registry.gitlab.com>
---
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
      imagePullSecrets: [{ name: gitlab-regcred }]
      containers:
        - name: techshop-dev-container
          image: registry.gitlab.com/vinh25042005/techshop-app/techshop:dev-28
          imagePullPolicy: IfNotPresent
          ports: [{ containerPort: 3000 }]
YAML
kubectl --kubeconfig /tmp/demo-kubeconfig apply -f /tmp/app.yaml
```
> ⚠️ Tên ns/deployment/container phải **đúng quy ước** theo `PROJECT_NAME`+`ENVIRONMENT`
> (mục 0). Sai namespace → CD fail vì `namespace not found`.

### 7.6 Xoá project (khi không dùng nữa)

```bash
cd terraform/environments/demo/dev && terraform destroy -auto-approve
# + xoá Vault secret/k8s/demo-dev nếu muốn dọn sạch
```

---

## 8. Kịch bản C — CI + TRIGGER CD (build xong tự trigger job client)

**Params:** giống Kịch bản A nhưng `ENABLED_STAGES` thêm `"trigger-cd"` + 3 param client-sink:

```bash
--data-urlencode 'ENABLED_STAGES=["CheckSource","company-get-vault","build-push","trigger-cd"]' \
--data-urlencode 'JENKINS_CLIENT_URL=http://localhost:8080/job/client-sink' \
--data-urlencode 'JENKINS_CLIENT_USER=jenkins-client-user' \
--data-urlencode 'JENKINS_CLIENT_TOKEN=jenkins-client-token'
```

**Verify:** console `Trigger CD client success`; job `client-sink` xuất hiện build mới.

---

## 9. Kịch bản D — UAT/PROD + Select Execution Mode (input)

**Params:** giống Kịch bản A nhưng `ENVIRONMENT=uat` (hoặc `prd`).

**Khi chạy**, stage **Select Execution Mode** dừng lại chờ input:
1. Build page → **Proceed** → chọn **FULL_CICD** → **Proceed**.
2. Input thứ 2 → nhập branch `main` → **Proceed**.

> Có thể submit tự động bằng `/tmp/submit_input.py <build> FULL_CICD main`.

**Verify:** console `FULL_CICD: Đã xác nhận, sẽ build từ branch: main` →
push `techshop:uat-<số-build>` → SUCCESS. Ảnh: `docs/screenshots/4-uat-*`.

---

## 10. Bảng tham chiếu nhanh "dùng kịch bản nào"

| Nhu cầu khách | Kịch bản | `ENABLED_STAGES` (company) | `CLIENT_ENABLED_STAGES` | Credential thêm |
|---|---|---|---|---|
| Chỉ lấy image | A — CI | `["CheckSource","company-get-vault","build-push"]` | (bỏ) | — |
| Deploy image có sẵn lên K8s trần | B — CD | `["CheckSource"]` | `["get-vault-dc","secret-dc","deploy-dc"]` | `demo-kubeconfig`/`dc-kubeconfig` |
| Build xong tự trigger client | C — CI+trigger | `[...,"trigger-cd"]` | (bỏ) | `jenkins-client-user/token` |
| UAT/PROD có input chọn mode | D — UAT | `["CheckSource","company-get-vault","build-push"]` (ENV=uat) | (bỏ) | — |

---

## 11. Lỗi thường gặp & cách xử lý

| Triệu chứng | Nguyên nhân | Cách fix |
|---|---|---|
| `vault kv get -field=ENV_FILE ... Not enough arguments` | Thiếu `VAULT_PATH` | Truyền `VAULT_PATH=secret/techshop` |
| `kubectl ... namespace not found` | Deployment/ns chưa tạo hoặc sai tên | Tạo sẵn theo đúng quy ước naming (mục 7.5) |
| curl `bad range in URL` | `[ ]` trong URL | Thêm `-g` (globoff) |
| curl không trả lời / HTTP 000 | Proxy env hoặc tunnel chết | `--noproxy '*'`; kiểm tra lại tunnel 9090 |
| `Build Aborted by user at selection step` | Submit input sai (crumb) | Submit qua UI Proceed, hoặc dùng `/tmp/submit_input.py` |
| Deploy rollout treo/fail | Image không chạy lâu | Dockerfile trong Vault phải `CMD sleep 3600` |
| Sau restart Jenkins, login fail | Admin password bị reset | Re-patch bcrypt hash (xem `docs/JENKINS-CICD-AIO-REPORT.md` mục 5.8) |

---

## 12. File tham chiếu

- `docs/CICD-AIO-SCENARIOS.md` — mô tả 7 kịch bản + bảng param điền/bỏ.
- `docs/JENKINS-CICD-AIO-REPORT.md` — plugins/credentials cài đặt, kết quả test, lưu ý.
- `docs/screenshots/` — ảnh từng kịch bản (gồm `demo-ci-*`, `demo-cd-*`).
- `CICD-AIO-Jenkins.groovy` — pipeline gốc (KHÔNG sửa).
