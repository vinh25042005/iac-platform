# Report — Cài đặt Jenkins để chạy `CICD-AIO-Jenkins.groovy`

> Jenkins: `techshop-jenkins` (EC2 47.130.241.226, Docker `jenkins/jenkins:lts-jdk21`, home `/jenkins-home`)
> Version Jenkins: **2.568.1** | Job: **`all_in_one`** (Pipeline from SCM → GitHub `iac-platform`/`CICD-AIO-Jenkins.groovy`, branch `main`)
> Admin: `admin` / `Admin@123456` (đã reset; API token cũ vẫn dùng được)
> Thời điểm: 2026-08-13

---

## 1. Những gì ĐÃ CÀI vào Jenkins để chạy file này

### 1.1 Plugin (cài thêm / nâng cấp — nguyên nhân vì sao)

| Plugin | Version | Vì sao cần | Ghi chú |
|--------|---------|------------|---------|
| **Office-365-Connector** | **5.3.0** (nâng từ 4.17.0) | Pipeline gọi `office365ConnectorSend` (gửi Teams STARTED/SUCCESS) ở Initialization + post actions | ⚠️ Bản 4.17.0 cũ **fail** trên Jenkins 2.568 vì thiếu `commons-httpclient` (bị bỏ khỏi core) → `NoClassDefFoundError` làm fail build. **5.3.0 dùng `apache-httpcomponents-client-5-api`, không cần commons-httpclient**. |
| **http_request** | 1.25 | Pipeline gọi DSL `httpRequest` (gửi chi tiết lỗi/configure log/unit-test log tới Teams webhook) ở post-failure + các hàm client | ⚠️ Cần dep **`apache-httpcomponents-client-5-api`** (5.5-150.veb_...) — thiếu → plugin không load được → `NoSuchMethodError: httpRequest`. |
| **apache-httpcomponents-client-5-api** | 5.5-150.veb_... | Dependency bắt buộc của `http_request` 1.25 và `Office-365-Connector` 5.3.0 | Đã cài cùng 2 plugin trên. |
| **pipeline-utility-steps** | 2.13.0 | Pipeline gọi DSL **`readJSON`/`writeJSON`** trong `applySecrets()` (client-side Apply Secrets) + nhiều hàm client | ⚠️ Thiếu → build client-side fail: `NoSuchMethodError: readJSON`. Cần dep `snakeyaml-api` (đã có sẵn). |
| snakeyaml-api / snakeyaml-engine-api | 2.5-149 / 3.0.1 | Dependency của pipeline-utility-steps | Có sẵn / tự cài. |

**Plugin đã có sẵn (không cần thêm) mà pipeline dùng:** `workflow-cps`, `workflow-job`, `workflow-aggregator`, `git`, `credentials`, `credentials-binding`, `plain-credentials`, `ssh-credentials`, `junit`, `timestamper`, `structs`, `hashicorp-vault-plugin`/`pipeline` (dùng cho Jenkinsfile cũ — CICD-AIO dùng `vault` CLI, không dùng plugin Vault), `generic-webhook-trigger`/`github*` (cho Jenkinsfile cũ).

### 1.2 Credentials (đã tạo — ID dùng trong params pipeline)

| Credential ID | Loại | Nội dung | Param pipeline dùng |
|---------------|------|----------|---------------------|
| `gitlab-token` | Secret text | GitLab PAT (full scope) | `GITLAB_ACCESS_TOKEN` — clone GitLab source |
| `gitlab-registry-auth` | Secret file | `~/.docker/config.json` cho `registry.gitlab.com` | `REGISTRY_AUTH` — docker login/push |
| `vault-token` | Secret text | Vault token (company Vault 52.221.18.86) | `COMPANY_VAULT_TOKEN`, `DC_VAULT_TOKEN` |
| `dc-kubeconfig` | Secret file | Kubeconfig DC cluster `dc-dev` | `DC_KUBE_CONFIG_FILE` — kubectl deploy |
| (cũ) `vault-approle-jenkins` | AppRole | Dùng cho Jenkinsfile cũ | — |
| (cũ) `github-token`, `github-token-secret` | — | Dùng cho Jenkinsfile cũ | — |

### 1.3 Cấu hình hệ thống (đã đổi)

- **Global env `VAULT_SKIP_VERIFY=true`**: bắt buộc vì Vault dùng **cert tự ký** → nếu không set, `vault login` fail: `x509: certificate signed by unknown authority`. (Set qua Script Console; KHÔNG sửa `config.xml` tay — sai XML làm NPE mọi build.)
- **Job `all_in_one`**: đổi từ job rỗng → **Pipeline from SCM** (`git` → `https://github.com/vinh25042005/iac-platform.git`, branch `*/main`, scriptPath `CICD-AIO-Jenkins.groovy`).
- **Admin password**: reset thành `admin` / `Admin@123456` (patch bcrypt hash trong user config; `Details` không có `setPassword` nên phải patch file).
- *(Không set global Teams webhook — pipeline nhận `TEAMS_WEBHOOK_URL` qua param; rỗng = không gửi, không fail vì plugin 5.3.0 xử lý async.)*

---

## 2. Stage nào chạy trong trường hợp nào (điều kiện từ code)

> Quy ước: `ENABLED_STAGES` (company), `CLIENT_ENABLED_STAGES` (client), `CLIENT_ENV_ACTION`, `LOCATION`, `CLIENT_LOCATION`, `ENVIRONMENT`.
> `ACTION_TYPE` mặc định `FULL_CICD`; chỉ có thể đổi ở "Select Execution Mode" (khi ENVIRONMENT=uat/prod).

| # | Stage | Khi nào chạy | Việc làm |
|---|-------|--------------|----------|
| 1 | **Initialization** | Luôn | Đặt displayName, gửi Teams STARTED (nếu có webhook) |
| 2 | **Select Execution Mode** | **Chỉ `ENVIRONMENT=uat`/`prod`** + `LOCATION=company-side` | `input()` chọn FULL_CICD / TRIGGER_CD_ONLY (dev/sit/release tự skip) |
| 3 | **Get release version information** | Luôn | In thông tin release (project, env, stage, image tag...) |
| 4 | **Checkout Source code** | `LOCATION=company-side` | Clone GitLab `SOURCE_CODE_PATH` (branch `BRANCH_CODE`) qua credential `GITLAB_ACCESS_TOKEN` |
| 5 | **Get secrets from Vault** | 3 nhánh (ưu tiên client trước): <br>• Client DC: `CLIENT_LOCATION=client-side` + `client-deploy` + `CLIENT_ENABLED_STAGES` chứa `get-vault-dc` → dùng `DC_VAULT_ADDR/TOKEN` <br>• Client DR: ... chứa `get-vault-dr` → dùng `DR_VAULT_*` <br>• Company: `LOCATION=company-side` + `ENABLED_STAGES` chứa `company-get-vault` → dùng `COMPANY_VAULT_ADDR/TOKEN` | `vault kv get` từng key theo `*_SECRET_VAULT` → ghi file theo `*_LOCATION_VAULT` (VD DOCKER_FILE→Dockerfile, GRUNTFILE→Gruntfile.js; client ENV_FILE→sit.js...) |
| 6 | **Process package.json and dependencies** | `LOCATION=company-side` + (MODULE_DEPLOY hợp lệ) | Xử lý module theo `MODULE_DEPLOY` (backend/frontend...) |
| 7 | **Grunt source** | `LOCATION=company-side` + `ENABLED_STAGES` chứa `grunt-backend`/`grunt-frontend` | Cài grunt-cli + chạy `grunt` (backend/frontend), cleanup |
| 8 | **Build and push image** | `LOCATION=company-side` + `ENABLED_STAGES` chứa `build-push` | Docker build (Dockerfile từ Vault) + push `REGISTRY_URL/…/REPOSITORY_NAME/PROJECT:ENV-BUILD_ID` |
| 9 | **Clean old docker images** | `LOCATION=company-side` + `ENABLED_STAGES` chứa `clean-image` | Xoá image cũ (giữ N mới) |
| 10 | **Trigger CD client** | `LOCATION=company-side` + `ENABLED_STAGES` chứa `trigger-cd` | POST tới `JENKINS_CLIENT_URL` để trigger build client |
| 11 | **Apply Secrets** | `CLIENT_LOCATION=client-side` + `client-deploy` + `CLIENT_ENABLED_STAGES` chứa `secret-dc`/`secret-dr` | `kubectl create secret generic <CLIENT_SECRET_NAME[i]> --from-file=<project>-<env>/<CLIENT_LOCATION_VAULT[i]>` trong ns |
| 12 | **Unit Test before deploy** | `CLIENT_LOCATION=client-side` + `client-deploy` + `CLIENT_ENABLED_STAGES` chứa `unit-test-dc`/`unit-test-dr` | Tạo `<proj>-<env>-unit-test-deployment` (thay IMAGE=IMAGETAG), chạy test trên pod, gửi log, scale-down |
| 13 | **Deploy to Cluster** | `CLIENT_LOCATION=client-side` + `client-deploy` + `CLIENT_ENABLED_STAGES` chứa `deploy-dc`/`deploy-dr`/`deploy-erp` | `kubectl set image deployment.apps/<proj>-<env>-deployment <proj>-<env>-container=<IMAGETAG>` + `rollout status` |
| 14 | **Apply configure to DC and DR** | `CLIENT_LOCATION=client-side` + `client-deploy` + `CLIENT_ENABLED_STAGES` chứa `configure-dc`/`configure-dr` | Apply k8s config, check pod status, lấy log |
| 15 | **Trigger DC and DR deploy** | `CLIENT_LOCATION=client-side` + **`client-trigger`** + `CLIENT_ENABLED_STAGES` chứa `trigger-dc`/`trigger-dr` | Trigger Jenkins `DC_JENKINS_URL`/`DR_JENKINS_URL` |
| 16 | **Replace vault pipeline** | `CLIENT_LOCATION=client-side` + `client-deploy` + `CLIENT_ENABLED_STAGES` chứa `replace-vault-pipeline` | Thay vault pipeline (VD đường dẫn mới) |
| 17 | **Work Flow Process** | `CLIENT_LOCATION=client-side` + `client-deploy` + `CLIENT_ENABLED_STAGES` chứa `workflow-process-pipeline` | Xử lý luồng cuối |

**Post actions:** success → Teams SUCCESS; failure → capture stage lỗi + gửi chi tiết (office365ConnectorSend/httpRequest nếu có `TEAMS_WEBHOOK_URL`).

---

## 3. Bảng "param nào dùng cho stage nào / trường hợp nào"

| Param | Dùng cho | Cần khi |
|-------|----------|---------|
| `PROJECT_NAME`, `ENVIRONMENT`, `REPOSITORY_NAME` | Tên image, namespace/deployment | Luôn |
| `LOCATION` (`company-side` / `client-side`) | Bật/tắt khối Company vs Client stage | Luôn (company CI: `company-side`) |
| `SOURCE_CODE_PATH`, `BRANCH_CODE`, `GITLAB_ACCESS_TOKEN` | Stage Checkout (4) | Company CI + client (cần source) |
| `REGISTRY_URL`, `REGISTRY_AUTH` | Stage Build & Push (8) | Company CI có `build-push` |
| `ENABLED_STAGES` | Bật/tắt stage company (CheckSource, company-get-vault, build-push, clean-image, trigger-cd, grunt-*) | Luôn — **phải truyền rõ** (default thiếu `company-get-vault`) |
| `COMPANY_VAULT_ADDR`, `COMPANY_VAULT_TOKEN` | GetVault company (5) | Company CI + `company-get-vault` |
| `VAULT_PATH` | Path secret (VD `secret/techshop`) | GetVault (cả company + client) |
| `COMPANY_SECRET_VAULT`, `COMPANY_LOCATION_VAULT` | Map secret→file cho build (DOCKER_FILE→Dockerfile) | Company CI (có default đúng) |
| `MODULE_DEPLOY`, `NODEJS_VERSION` | Stage Process package.json (6) / env node | Tuỳ chọn (rỗng = bỏ qua) |
| `TEAMS_WEBHOOK_URL` | Gửi Teams (post + init) | **Không bắt buộc** — rỗng = không gửi, không fail |
| `IMAGETAG` | Stage Deploy to Cluster (13) + Trigger CD (10/15) | Client CD |
| `CLIENT_LOCATION`, `CLIENT_ENV_ACTION` (`client-deploy`/`client-trigger`) | Bật khối client stage | Client CD |
| `CLIENT_ENABLED_STAGES` | Bật client stage cụ thể (`get-vault-dc`, `secret-dc`, `unit-test-dc`, `deploy-dc`, `configure-dc`, `trigger-dc`...) | Client CD |
| `CLIENT_SECRET_VAULT`, `CLIENT_SECRET_NAME`, `CLIENT_LOCATION_VAULT` | GetVault client (5) + Apply Secrets (11) | Client CD |
| `DC_VAULT_ADDR`, `DC_VAULT_TOKEN` | GetVault client (DC) | Client CD lên DC |
| `DC_KUBE_CONFIG_FILE` | Apply Secrets/Deploy/Configure (11,13,14) | Client CD (credential Secret file kubeconfig) |
| `DR_*` (VAULT/KUBE/JENKINS...) | Client CD lên DR | Chỉ khi dùng DR |
| `ERP_*` | Stage Deploy ERP (13-deploy-erp) | Chỉ khi deploy ERP (đã bỏ qua) |

---

## 4. Kết quả test đã chạy (bằng chứng)

| Build | Kịch bản | Stages chính chạy | Kết quả |
|-------|----------|-------------------|---------|
| 6–8 | Company CI (dev/sit/release) | Checkout → GetVault(company) → Build&Push | ✅ SUCCESS |
| 9 | Company CI (bỏ webhook) | như trên | ✅ SUCCESS |
| 10 | Company CI (minimal params) | như trên | ✅ SUCCESS |
| 11 | Company CI (image sleep) | như trên → push `dev-11` | ✅ SUCCESS |
| 12 | Client CD (lần đầu) | GetVault(client) → Apply Secrets | ❌ FAIL (thiếu plugin readJSON) |
| 13 | Client CD (sau fix) | GetVault(client) → **Apply Secrets** → **Deploy to Cluster** (`kubectl set image` → `dev-11`) | ✅ SUCCESS |

Xem thêm `docs/screenshots/README.md` + 28 ảnh trong `docs/screenshots/`.

---

## 5. Lưu ý vận hành / lỗi gặp phải & cách fix

1. **office365ConnectorSend fail** (`NoClassDefFoundError: commons-httpclient`) → upgrade Office-365-Connector lên **5.3.0** (kèm `apache-httpcomponents-client-5-api`).
2. **httpRequest NoSuchMethodError** → cài `http_request` 1.25 + dep `apache-httpcomponents-client-5-api`, restart Jenkins.
3. **readJSON NoSuchMethodError** (client Apply Secrets) → cài `pipeline-utility-steps` 2.13.0.
4. **Vault TLS** (`x509: signed by unknown authority`) → global env `VAULT_SKIP_VERIFY=true`.
5. **VAULT_PATH sai** → phải là `secret/techshop` (KV v2 tự thêm `data/`; dùng `secret/data/techshop` sẽ lookup `secret/data/data/techshop`).
6. **Deploy rollout status treo/fail** → Dockerfile image phải chạy lâu (CMD sleep); image chỉ `echo` sẽ exit → pod Completed.
7. **`ENABLED_STAGES` phải truyền rõ** (default `["CheckSource","GetVault"]` không chứa `company-get-vault`).
8. Sau **restart Jenkins**, admin password có thể bị đổi → nếu web login fail, re-patch bcrypt hash `#jbcrypt:$2a$10$/Sxcnq2FO23BoKty7ydiieUbCe2/UTn0hVuez3GTHSzFhccXzDuWm` vào `/jenkins-home/users/admin_*/config.xml` + reload.
