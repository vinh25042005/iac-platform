# CICD-AIO-Jenkins.groovy — Các kịch bản sử dụng & param cần điền / bỏ qua

> **Muốn tự chạy lại từng bước (lệnh copy-paste đầy đủ + credential từng trường hợp) → xem [`docs/HUONG-DAN-CHAY-LAI.md`](./HUONG-DAN-CHAY-LAI.md).**

> Nguyên tắc: `LOCATION`/`ENABLED_STAGES` bật khối **Company**; `CLIENT_LOCATION`/`CLIENT_ENV_ACTION`/`CLIENT_ENABLED_STAGES` bật khối **Client**.
> Stage nào không cần thì **để param rỗng/default** → stage đó tự skip (không ảnh hưởng build).

## Các param điều khiển chính

| Param | Giá trị | Ý nghĩa |
|---|---|---|
| `LOCATION` | `company-side` | Bật khối Company (Checkout, GetVault company, Build...) |
| `ENABLED_STAGES` | `["CheckSource","company-get-vault","build-push", ...]` | Bật từng stage company |
| `MODULE_DEPLOY` | `backend` / `frontend` / rỗng | Bật stage Process package.json (phải chứa backend/frontend) |
| `CLIENT_LOCATION` | `client-side` | Bật khối Client |
| `CLIENT_ENV_ACTION` | `client-deploy` / `client-trigger` | Deploy thẳng hay trigger Jenkins khác |
| `CLIENT_ENABLED_STAGES` | `["get-vault-dc","secret-dc","deploy-dc", ...]` | Bật từng stage client |
| `ENVIRONMENT` | `dev/sit/release/uat/prod` | `uat`/`prod` → hiện Select Execution Mode (input) |

---

## Kịch bản 1 — CHỈ CI (khách chỉ cần image, không deploy)

**Điền:**
```
LOCATION=company-side
ENABLED_STAGES=["CheckSource","company-get-vault","build-push"]   # + "grunt-backend" nếu cần grunt, + "clean-image"
PROJECT_NAME, ENVIRONMENT, SOURCE_CODE_PATH, BRANCH_CODE, GITLAB_ACCESS_TOKEN
REGISTRY_URL, REGISTRY_AUTH, REPOSITORY_NAME
COMPANY_VAULT_ADDR, COMPANY_VAULT_TOKEN, VAULT_PATH
COMPANY_SECRET_VAULT=["DOCKER_FILE","GRUNTFILE"], COMPANY_LOCATION_VAULT=["Dockerfile","Gruntfile.js"]
```
**Bỏ qua (rỗng):** `CLIENT_LOCATION`, `CLIENT_ENV_ACTION`, `CLIENT_ENABLED_STAGES`, `IMAGETAG`, toàn bộ `DC_*`, `DR_*`, `ERP_*`, `JENKINS_CLIENT_*`.
**Kết quả:** build + push `image:ENV-BUILD_ID`, dừng.

---

## Kịch bản 2 — CHỈ CD (khách đã có image, chỉ deploy lên cluster)

**Điền:**
```
LOCATION=company-side
ENABLED_STAGES=["CheckSource"]              # chỉ checkout lấy source + helper, KHÔNG build
CLIENT_LOCATION=client-side
CLIENT_ENV_ACTION=client-deploy
CLIENT_ENABLED_STAGES=["get-vault-dc","secret-dc","deploy-dc"]   # + "unit-test-dc", "configure-dc" nếu cần
IMAGETAG=<image CÓ SẴN>                     # VD registry.gitlab.com/.../techshop:dev-20
CLIENT_SECRET_VAULT=["ENV_FILE","CONFIG_ENV"], CLIENT_SECRET_NAME=["env-file-secret","config-env-secret"], CLIENT_LOCATION_VAULT=["sit.js","configEnv.js"]
DC_VAULT_ADDR, DC_VAULT_TOKEN, DC_KUBE_CONFIG_FILE
```
**Bỏ qua (rỗng):** `REGISTRY_URL`, `REGISTRY_AUTH` (không build), `COMPANY_VAULT_*` (nếu không cần), `MODULE_DEPLOY`, `ENABLED_STAGES` build.
**Kết quả:** Apply Secrets + Deploy (`kubectl set image`) image có sẵn lên cluster.

---

## Kịch bản 3 — CI + CD (khách cần triển khai, full flow)

**Điền:** kết hợp kịch bản 1 + 2:
```
LOCATION=company-side
ENABLED_STAGES=["CheckSource","company-get-vault","build-push"]   # + grunt/clean nếu cần
MODULE_DEPLOY=backend (nếu cần process package.json)
CLIENT_LOCATION=client-side, CLIENT_ENV_ACTION=client-deploy
CLIENT_ENABLED_STAGES=["get-vault-dc","secret-dc","deploy-dc"]
IMAGETAG=<image build sẽ tạo — ENV-BUILD_ID dự đoán>  (hoặc chạy 2 bước: CI → trigger CD)
... + tất cả param company + client
```
**Bỏ qua:** các param kịch bản khác (DR/ERP/trigger).
**Kết quả:** build+push image → apply secret → deploy lên cluster.

> ⚠️ Lưu ý: cùng 1 lần chạy thì `IMAGETAG` phải trỏ đúng tag build sẽ đẩy (ENV-BUILD_ID). Hoặc tách 2 bước: chạy CI (kịch bản 1) → rồi CD (kịch bản 2) với tag vừa build.

---

## Kịch bản 4 — UAT/PROD + TRIGGER CD (nhập tay thông tin deploy)

**Điền:**
```
ENVIRONMENT=uat  (hoặc prod)
LOCATION=company-side
ENABLED_STAGES=["CheckSource","company-get-vault","build-push"]   # bật build nếu FULL_CICD
```
**Khi chạy:** stage **Select Execution Mode** hiện input → chọn:
- `FULL_CICD` → build + deploy (giống kịch bản 3)
- `TRIGGER_CD_ONLY` → **bỏ qua CI**, nhập tay `IMAGETAG`/`TIMESTAMP`/`COMMIT_NAME`/`COMMIT_MESSAGE` → chỉ trigger CD.
**Bỏ qua:** không cần điền trước `IMAGETAG` (nhập khi build chạy).

---

## Kịch bản 5 — Deploy DR (disaster recovery cluster)

**Điền:**
```
CLIENT_LOCATION=client-side, CLIENT_ENV_ACTION=client-deploy
CLIENT_ENABLED_STAGES=["get-vault-dr","secret-dr","deploy-dr"]     # dùng "-dr" thay vì "-dc"
DR_VAULT_ADDR, DR_VAULT_TOKEN, DR_KUBE_CONFIG_FILE
IMAGETAG=<image>
```
**Bỏ qua:** toàn bộ `DC_*` (chỉ dùng DR).
**Kết quả:** deploy image lên DR cluster.

---

## Kịch bản 6 — Trigger DC/DR từ Jenkins client (khách trigger từ xa)

**Điền:**
```
CLIENT_LOCATION=client-side
CLIENT_ENV_ACTION=client-trigger
CLIENT_ENABLED_STAGES=["trigger-dc"]      # hoặc "trigger-dr"
DC_JENKINS_URL, DC_JENKINS_USER, DC_JENKINS_TOKEN   # (hoặc DR_*)
IMAGETAG=<image>
```
**Bỏ qua:** `secret-dc`/`deploy-dc` (không tự deploy, chỉ trigger Jenkins DC/DR).

---

## Kịch bản 7 — Deploy ERP (ERPNext)

**Điền:**
```
CLIENT_LOCATION=client-side, CLIENT_ENV_ACTION=client-deploy
CLIENT_ENABLED_STAGES=["deploy-erp"]
ERP_URL, ERP_IP_ADDR, ERP_SSH_KEY, ERP_SSH_PORT, ERP_APP_NAME
```
**Bỏ qua:** DC/DR.

---

## Bảng tổng hợp nhanh "điền / bỏ"

| Kịch bản | LOCATION | ENABLED_STAGES (company) | CLIENT_LOCATION/ACTION | CLIENT_ENABLED_STAGES | IMAGETAG | DC_*/DR_* |
|---|---|---|---|---|---|---|
| 1. Chỉ CI | company-side | build-push... | rỗng | rỗng | ✗ | ✗ |
| 2. Chỉ CD | company-side (chỉ Checkout) | CheckSource | client-side / client-deploy | get-vault-dc, secret-dc, deploy-dc | ✔ (có sẵn) | DC |
| 3. CI+CD | company-side | build-push... | client-side / client-deploy | get-vault-dc, secret-dc, deploy-dc | ✔ (dự đoán) | DC |
| 4. UAT/PRD trigger | company-side | build-push... | (nhập khi chạy) | (nhập khi chạy) | nhập tay | DC |
| 5. Chỉ DR | — (Checkout) | CheckSource | client-side / client-deploy | get-vault-dr, secret-dr, deploy-dr | ✔ | DR |
| 6. Trigger DC/DR | — | — | client-side / client-trigger | trigger-dc | ✔ | DC_JENKINS_* |
| 7. Deploy ERP | — | — | client-side / client-deploy | deploy-erp | ✔ | ERP_* |

✗ = bỏ qua / không cần.

## Bảng "stage nào cần param nào" (điền ít nhất)

| Stage | Param bắt buộc tối thiểu |
|---|---|
| Checkout Source | `SOURCE_CODE_PATH`, `BRANCH_CODE`, `GITLAB_ACCESS_TOKEN` |
| GetVault (company) | `COMPANY_VAULT_ADDR/TOKEN`, `VAULT_PATH`, `COMPANY_SECRET_VAULT/LOCATION_VAULT` |
| GetVault (client DC) | `DC_VAULT_ADDR/TOKEN`, `VAULT_PATH`, `CLIENT_SECRET_VAULT/LOCATION_VAULT` |
| Process package.json | `MODULE_DEPLOY=backend|frontend` |
| Grunt | `ENABLED_STAGES` chứa `grunt-backend`/`grunt-frontend` |
| Build & Push | `REGISTRY_URL`, `REGISTRY_AUTH`, `REPOSITORY_NAME` |
| Clean image | `ENABLED_STAGES` chứa `clean-image` |
| Trigger CD client | `trigger-cd` + `JENKINS_CLIENT_URL/USER/TOKEN` |
| Apply Secrets | `secret-dc/dr` + `DC/DR_KUBE_CONFIG_FILE` + `CLIENT_SECRET_NAME/LOCATION_VAULT` |
| Unit Test | `unit-test-dc/dr` + `unit-test.yaml` trong repo + kubeconfig |
| Deploy to Cluster | `deploy-dc/dr/erp` + `IMAGETAG` + kubeconfig |
| Apply configure | `configure-dc/dr` + `pod-configure.yaml`/`configure.sh` trong repo |
| Trigger DC/DR | `client-trigger` + `trigger-dc/dr` + `DC/DR_JENKINS_URL/USER/TOKEN` |
| Replace vault | `replace-vault-pipeline` + `replace-vault-pipeline.py` trong repo |
| Work Flow Process | `workflow-process-pipeline` + `workflow-process.py` trong repo |
