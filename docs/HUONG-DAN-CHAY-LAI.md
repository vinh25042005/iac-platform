# Hướng dẫn chạy lại pipeline trên GIAO DIỆN Jenkins (từng kịch bản)

> Hướng dẫn này thao tác **100% bằng chuột trên giao diện Jenkins** — không cần dùng file, script hay lệnh.
> Bạn chỉ cần: mở trình duyệt → đăng nhập Jenkins → điền form → bấm Build → đọc kết quả trên màn hình.

---

## 1. Mở & đăng nhập Jenkins

1. Mở trình duyệt (Chrome/Edge...).
2. Vào địa chỉ: **`http://localhost:9090`**
   (yêu cầu SSH tunnel tới máy Jenkins đang mở — nếu chưa, mở tunnel như lúc cài rồi vào lại).
3. Trang **Sign in - Jenkins** hiện ra → nhập:
   - **Username**: `admin`
   - **Password**: mật khẩu admin đã đặt
   - Bấm **Sign in**.

Sau khi đăng nhập, bạn ở trang **Dashboard** — danh sách các job.

---

## 2. Mở job `all_in_one`

1. Trên Dashboard, tìm job **`all_in_one`** → bấm vào tên.
2. Trang job có:
   - **Menu bên trái**: **Build with Parameters**, **Build History**, ...
   - **Phần giữa**: mô tả job + build gần nhất.

---

## 3. Mở form điền tham số & chạy build

1. Bấm **Build with Parameters** (menu bên trái).
2. Trang form hiện ra với **rất nhiều ô** (PROJECT_NAME, ENVIRONMENT, ..., IMAGETAG, CLIENT_*, DC_*...).
   **Chỉ điền các ô cần thiết** — các ô khác để nguyên mặc định / để trống; pipeline tự bỏ qua stage không bật.
3. Điền xong → bấm nút **Build** (cuối form).

Build mới hiện trên cùng cột **Build History** (menu trái trang job). Bấm vào số build (VD `#28`) để xem chi tiết.

---

## 4. Cách đọc kết quả trên giao diện

Trên trang của 1 build:

- **Stage View** (bảng ngang đầu trang): mỗi cột là 1 stage.
  - 🟢 **Xanh** = thành công
  - 🔴 **Đỏ** = lỗi (bấm vào cột đỏ để xem log lỗi)
  - ⚪ **Xám** = bị bỏ qua (bình thường khi param không bật stage đó)
  - 🟡 **Vàng / nhấp nháy** = đang chạy
- **Console Output** (menu bên trái): log đầy đủ. Dòng cuối **`Finished: SUCCESS`** = thành công; **`Finished: FAILURE`** = lỗi.
- Dùng **Ctrl+F** trong Console Output để tìm từ khoá (mỗi kịch bản nêu cụ thể bên dưới).

---

## Kịch bản A — Company CI (chỉ build + push image)

**Mục đích:** tạo image `techshop:dev-<số-build>` đẩy lên GitLab Registry. Không deploy.
**Credential dùng (đã có sẵn, không cần tạo):** `gitlab-token`, `gitlab-registry-auth`, `vault-token`.

**Bước 1 — Mở Build with Parameters, điền từng ô:**

| Ô trên form | Giá trị cần điền |
|---|---|
| `PROJECT_NAME` | `techshop` |
| `ENVIRONMENT` | `dev` |
| `LOCATION` | `company-side` |
| `SOURCE_CODE_PATH` | `vinh25042005/techshop-app` |
| `BRANCH_CODE` | `main` |
| `GITLAB_ACCESS_TOKEN` | `gitlab-token` ← **tên credential**, không phải token thật |
| `REGISTRY_URL` | `registry.gitlab.com/vinh25042005` |
| `REGISTRY_AUTH` | `gitlab-registry-auth` ← tên credential |
| `COMPANY_VAULT_ADDR` | `https://52.221.18.86:8200` |
| `COMPANY_VAULT_TOKEN` | `vault-token` ← tên credential |
| `VAULT_PATH` | `secret/techshop` |
| `REPOSITORY_NAME` | `techshop-app` |
| `ENABLED_STAGES` | `["CheckSource","company-get-vault","build-push"]` |
| `COMPANY_SECRET_VAULT` | `["DOCKER_FILE","GRUNTFILE"]` |
| `COMPANY_LOCATION_VAULT` | `["Dockerfile","Gruntfile.js"]` |
| `TEAMS_WEBHOOK_URL` | (để trống) |
| Tất cả ô `CLIENT_*`, `DC_*`, `DR_*` | (để trống — không bật) |

**Bước 2 — Bấm Build.**

**Bước 3 — Xem kết quả:**
- Stage View: **Checkout Source code** → **Get secrets from Vault** → **Build and push image** đều 🟢 xanh.
- Console Output (Ctrl+F `naming to`): `naming to registry.gitlab.com/vinh25042005/techshop-app/techshop:dev-<số-build> done`.
- Cuối console: `Finished: SUCCESS`.

---

## Kịch bản B — Client CD (deploy image lên cluster — KHÔNG ArgoCD)

**Mục đích:** deploy image **đã có sẵn** (VD `dev-28`) thẳng lên cluster bằng kubectl — không qua ArgoCD.
**Credential dùng (đã có sẵn):** `vault-token`, `demo-kubeconfig` (kubeconfig cluster demo; muốn deploy lên cluster khác thì dùng credential kubeconfig tương ứng).

> ⚠️ **Trước khi chạy lần đầu:** cluster đích phải có sẵn namespace `techshop-dev-ns` và deployment
> `techshop-dev-deployment` (đúng quy ước `<project>-<env>-ns` / `<project>-<env>-deployment`)
> vì pipeline chỉ **đổi image** (`kubectl set image`), không tạo deployment.

**Bước 1 — Mở Build with Parameters, điền từng ô:**

| Ô trên form | Giá trị cần điền |
|---|---|
| `IMAGETAG` | `registry.gitlab.com/vinh25042005/techshop-app/techshop:dev-28` ← image đã build ở kịch bản A |
| `PROJECT_NAME` | `techshop` |
| `ENVIRONMENT` | `dev` |
| `LOCATION` | `company-side` |
| `SOURCE_CODE_PATH` | `vinh25042005/techshop-app` |
| `BRANCH_CODE` | `main` |
| `GITLAB_ACCESS_TOKEN` | `gitlab-token` |
| `VAULT_PATH` | `secret/techshop` ← **bắt buộc** (thiếu sẽ lỗi) |
| `ENABLED_STAGES` | `["CheckSource"]` ← chỉ checkout, không build |
| `CLIENT_LOCATION` | `client-side` |
| `CLIENT_ENV_ACTION` | `client-deploy` |
| `CLIENT_ENABLED_STAGES` | `["get-vault-dc","secret-dc","deploy-dc"]` |
| `CLIENT_SECRET_VAULT` | `["ENV_FILE","CONFIG_ENV"]` |
| `CLIENT_SECRET_NAME` | `["env-file-secret","config-env-secret"]` |
| `CLIENT_LOCATION_VAULT` | `["sit.js","configEnv.js"]` |
| `DC_VAULT_ADDR` | `https://52.221.18.86:8200` |
| `DC_VAULT_TOKEN` | `vault-token` ← tên credential |
| `DC_KUBE_CONFIG_FILE` | `demo-kubeconfig` ← tên credential kubeconfig |
| Các ô `REGISTRY_*`, `COMPANY_*` còn lại, `DR_*` | (để trống) |

**Bước 2 — Bấm Build.**

**Bước 3 — Xem kết quả** (Console Output, Ctrl+F):
- `secret/env-file-secret created`
- `secret/config-env-secret created`
- `deployment "techshop-dev-deployment" successfully rolled out`
- `Finished: SUCCESS`

---

## Kịch bản C — CI + Trigger CD (build xong tự trigger job client)

**Mục đích:** như kịch bản A, nhưng sau khi push image sẽ **tự trigger** job `client-sink` của client.
**Credential dùng thêm:** `jenkins-client-user`, `jenkins-client-token`.

**Bước 1 — Mở Build with Parameters:** điền **giống hệt Kịch bản A**, chỉ khác 4 ô:

| Ô trên form | Giá trị cần điền |
|---|---|
| `ENABLED_STAGES` | `["CheckSource","company-get-vault","build-push","trigger-cd"]` |
| `JENKINS_CLIENT_URL` | `http://localhost:8080/job/client-sink` |
| `JENKINS_CLIENT_USER` | `jenkins-client-user` ← tên credential |
| `JENKINS_CLIENT_TOKEN` | `jenkins-client-token` ← tên credential |

**Bước 2 — Bấm Build.**

**Bước 3 — Xem kết quả:**
- Console: `Trigger CD client success`.
- Vào Dashboard → job `client-sink` → **Build History** thấy build mới = đã trigger thành công.

---

## Kịch bản D — UAT/PROD + hộp chọn (Select Execution Mode)

**Mục đích:** mô phỏng deploy môi trường uat/prod — build sẽ **dừng lại giữa chừng chờ bạn chọn**.

**Bước 1 — Mở Build with Parameters:** điền giống **Kịch bản A**, nhưng:
- **`ENVIRONMENT`** = `uat` (hoặc `prd`)
- `ENABLED_STAGES` = `["CheckSource","company-get-vault","build-push"]`

**Bước 2 — Bấm Build.** Build chạy tới stage **Select Execution Mode** rồi dừng (trạng thái "Paused for Input").

**Bước 3 — Thao tác khi build dừng (quan trọng):**
1. Mở build đang chạy → giữa trang hiện hộp vàng **Input requested**.
2. Bấm **Proceed** → hiện lựa chọn → chọn **`FULL_CICD`** → bấm **Proceed**.
3. Hộp **thứ 2** hỏi **Branch Code** → gõ `main` → bấm **Proceed**.
4. Build tiếp tục chạy: Checkout → Get secrets → Build and push (tag `uat-<số-build>`).

**Bước 4 — Xem kết quả:** Console có `FULL_CICD: Đã xác nhận, sẽ build từ branch: main`,
rồi `naming to .../techshop:uat-<số-build> done`, và `Finished: SUCCESS`.

> Không bấm gì → build chờ mãi. Muốn dừng → bấm **Abort**.

---

## Kịch bản E — Deploy lên cụm DR (Disaster Recovery)

**Mục đích:** deploy image lên **cụm dự phòng (DR)** — cụm K8s thứ 2 tách biệt. Đã test thật trên cụm `dr-dev` (small: 2 node t3.small) → build #32 ✅.

> ⚠️ Pipeline xử lý **1 cụm 1 build**: muốn deploy lên DR thì dùng đúng stage `*-dr` (KHÔNG trộn `*-dc`), và điền bộ param `DR_*` (không phải `DC_*`).
> Cụm DR cũng phải có sẵn namespace + deployment đúng tên (giống Kịch bản B).

**Bước 1 — Mở Build with Parameters, điền từng ô:**

| Ô trên form | Giá trị cần điền |
|---|---|
| `IMAGETAG` | `registry.gitlab.com/vinh25042005/techshop-app/techshop:dev-28` (image đã build) |
| `PROJECT_NAME` | `techshop` |
| `ENVIRONMENT` | `dev` |
| `LOCATION` | `company-side` |
| `SOURCE_CODE_PATH` | `vinh25042005/techshop-app` |
| `BRANCH_CODE` | `main` |
| `GITLAB_ACCESS_TOKEN` | `gitlab-token` |
| `VAULT_PATH` | `secret/techshop` |
| `ENABLED_STAGES` | `["CheckSource"]` |
| `CLIENT_LOCATION` | `client-side` |
| `CLIENT_ENV_ACTION` | `client-deploy` |
| `CLIENT_ENABLED_STAGES` | `["get-vault-dr","secret-dr","deploy-dr"]` ← dùng **`*-dr`** |
| `CLIENT_SECRET_VAULT` | `["ENV_FILE","CONFIG_ENV"]` |
| `CLIENT_SECRET_NAME` | `["env-file-secret","config-env-secret"]` |
| `CLIENT_LOCATION_VAULT` | `["sit.js","configEnv.js"]` |
| `DR_VAULT_ADDR` | `https://52.221.18.86:8200` |
| `DR_VAULT_TOKEN` | `vault-token` (tên credential) |
| `DR_KUBE_CONFIG_FILE` | `dr-kubeconfig` (tên credential kubeconfig cụm DR) |
| Các ô `DC_*`, `REGISTRY_*`, `COMPANY_*` | (để trống) |

**Bước 2 — Bấm Build.**

**Bước 3 — Xem kết quả** (Console Output, Ctrl+F): `secret/env-file-secret created`, `secret/config-env-secret created`, `deployment "techshop-dev-deployment" successfully rolled out`, `Finished: SUCCESS`.

> Để deploy **đồng thời DC + DR** (mô hình standby), chạy 2 build riêng: 1 build `*-dc` (kịch bản B) + 1 build `*-dr` (kịch bản E).

---

## 5. Tạo credential mới bằng giao diện (chỉ khi cần, VD thêm cluster mới)

Khi deploy lên cluster mới, cần credential kubeconfig mới:

1. Dashboard → **Manage Jenkins** → **Credentials** → **System** → **Global credentials (unrestricted)**.
2. Bấm **Add Credentials**.
3. **Kind** = **Secret file**.
4. **File** = bấm **Choose file** → chọn file kubeconfig của cluster đó.
5. **ID** = đặt tên, VD `demo-kubeconfig`.
6. Bấm **Create**.
7. Khi chạy Kịch bản B, ô **`DC_KUBE_CONFIG_FILE`** điền đúng **ID** vừa tạo.

---

## 6. Bảng tóm tắt nhanh (nhu cầu → điền gì)

| Nhu cầu | Kịch bản | `ENABLED_STAGES` | `CLIENT_ENABLED_STAGES` | Credential |
|---|---|---|---|---|
| Chỉ lấy image | A | `["CheckSource","company-get-vault","build-push"]` | (trống) | gitlab-token, gitlab-registry-auth, vault-token |
| Deploy image có sẵn | B | `["CheckSource"]` | `["get-vault-dc","secret-dc","deploy-dc"]` | vault-token, demo-kubeconfig |
| Build + trigger client | C | thêm `"trigger-cd"` | (trống) | + jenkins-client-user/token |
| UAT/PROD có hộp chọn | D | như A (ENV=uat/prd) | (trống) | như A |
| Deploy lên cụm DR | E | `["CheckSource"]` | `["get-vault-dr","secret-dr","deploy-dr"]` | vault-token, dr-kubeconfig |

---

## Webhook tự động CI khi dev push (không cần chạy tay)

Đã cài **tự động chạy CI** khi dev push code lên GitLab — không phải bấm "Build with Parameters" mỗi lần:

```
Dev push (branch dev) → GitLab webhook → HTTPS nginx proxy (8443) → job gitlab-webhook-ci
  → lọc branch dev → tự trigger all_in_one (ENV=dev, BRANCH=dev) → build+push image
```

- **Job `gitlab-webhook-ci`** trên Dashboard là job trung gian (nhận webhook, lấy project + branch, tự trigger `all_in_one`).
- **GitLab → Settings → Webhooks** đã đăng ký URL `https://47.130.241.226:8443/generic-webhook-trigger/invoke?token=...` (Push events, SSL verification tắt — cert self-signed).
- **Chỉ chạy khi push branch `dev`** (giống production — branch khác bị bỏ qua). Branch `dev` đã tạo trong repo techshop-app.
- **Kết quả trên UI:** mỗi lần push dev, trong **Build History** của `all_in_one` sẽ tự xuất hiện build mới (ENV=dev, BRANCH=dev) — chỉ cần vào xem Console Output / Stage View, không cần điền gì.
- Muốn tắt: vào job `gitlab-webhook-ci` → **Disable** (hoặc xoá webhook trong GitLab).
- Chi tiết kỹ thuật + lưu ý bảo mật: xem mục 6b trong báo cáo.

---

## Cấu hình webhook bằng GIAO DIỆN (tự làm lần sau)

### Phần A — Jenkins: tạo job nhận webhook

1. Dashboard → **New Item** → tên `gitlab-webhook-ci` → chọn **Pipeline** → **OK**.
2. Vào **Configure** job → mục **Pipeline** → **Definition** = **Pipeline script** → dán script (mẫu dưới).
3. **Save**, rồi **chạy job 1 lần** để đăng ký token (nếu không, webhook trả HTTP 404).
4. Kiểm tra: POST thử `https://<ip>:8443/generic-webhook-trigger/invoke?token=<TOKEN>` → nhận `200`.

Mẫu phần **triggers** trong script (chính là điểm quan trọng nhất):

```groovy
triggers {
  GenericTrigger(
    token: '<TOKEN>',
    printContributedVariables: true,
    printPostContent: true,
    silentResponse: false,
    genericVariables: [
      [key: 'GITLAB_PROJECT', value: '$.project.path_with_namespace'],
      [key: 'GITLAB_REF', value: '$.ref']
    ]
  )
}
```

> ⚠️ **GenericVariable khai báo bằng `value:`** — dùng `expression:` sẽ lỗi (NPE) khi load trigger.
> ⚠️ Sau **mỗi lần sửa config** của job này, phải **chạy job 1 lần** để đăng ký lại token (nếu không webhook trả 404).

### Phần B — GitLab: đăng ký webhook

1. Project `techshop-app` → **Settings → Webhooks → Add new webhook**.
2. **URL**: `https://47.130.241.226:8443/generic-webhook-trigger/invoke?token=<TOKEN>`.
3. Tick **Push events** (muốn lọc branch có thể dùng Wildcard/Regex, nhưng hiện filter branch nằm trong Jenkins).
4. **Bỏ tick "Enable SSL verification"** (vì cert self-signed).
5. **Add webhook**. Kiểm tra bằng **Test → Push events** (nếu GitLab test API không dùng được thì push 1 commit thật lên branch `dev`).

### Phần C — Bảo mật (đã cấu hình sẵn)

- Jenkins admin (**9090**) **không mở** ra internet (SG chỉ allowlist IP cụ thể) — vào bằng SSH tunnel.
- Webhook đi qua **nginx reverse proxy HTTPS** (port **8443**), chỉ forward đúng path `/generic-webhook-trigger/`; mọi path khác trả **403**.
- GitLab webhook trỏ `https://47.130.241.226:8443/...` (cert self-signed, SSL verification tắt).
- **Branch filter**: chỉ `dev` mới trigger CI (trong script receiver — branch khác echo "BO QUA" rồi dừng, không tạo build).

---

## Cheat sheet DEMO — bị bắt làm kịch bản bất kỳ thì làm sao

> Cách dùng: nghe yêu cầu → tra bảng dưới → chỉ cần đổi ĐÚNG ô khác biệt so với Kịch bản A (gốc CI).

### Bước 1 — Xác định kịch bản theo câu hỏi

| Nếu họ yêu cầu / nói | Kịch bản | Đổi gì so với A (gốc CI) |
|---|---|---|
| "Khách chỉ cần image" | **A — CI** | (không đổi — làm luôn) |
| "Khách đã có image, deploy lên DC" | **B — CD** | `ENABLED_STAGES=["CheckSource"]` + bật khối CLIENT (`client-deploy`, `*-dc`) |
| "Build xong tự trigger CD client" | **C — CI + trigger** | `ENABLED_STAGES` thêm `"trigger-cd"` + 3 ô `JENKINS_CLIENT_*` |
| "Môi trường UAT/PROD" | **D — UAT** | `ENVIRONMENT=uat`/`prd` + lúc chạy bấm Proceed → chọn FULL_CICD → gõ branch |
| "Deploy lên cụm dự phòng DR" | **E — DR** | Khối CLIENT dùng `*-dr` + bộ param `DR_*` |
| "Chạy đủ Unit Test + Configure + Replace Vault + Work Flow" | **F–I — CD đầy đủ** | `CLIENT_ENABLED_STAGES` thêm `unit-test-dc, configure-dc, replace-vault-pipeline, workflow-process-pipeline` |

### Bước 2 — Ô quan trọng nhất phải đúng

| Kịch bản | Ô "định mệnh" | Ô bắt buộc kèm theo |
|---|---|---|
| **A** | `LOCATION=company-side` | `ENABLED_STAGES=["CheckSource","company-get-vault","build-push"]` + `VAULT_PATH=secret/techshop` + các credential `gitlab-token`,`gitlab-registry-auth`,`vault-token` |
| **B** | `CLIENT_LOCATION=client-side` + `CLIENT_ENV_ACTION=client-deploy` | `IMAGETAG=...dev-XX` + `CLIENT_ENABLED_STAGES=["get-vault-dc","secret-dc","deploy-dc"]` + `DC_KUBE_CONFIG_FILE=demo-kubeconfig` |
| **C** | thêm `"trigger-cd"` vào `ENABLED_STAGES` | `JENKINS_CLIENT_URL=http://localhost:8080/job/client-sink` + `jenkins-client-user`/`jenkins-client-token` |
| **D** | `ENVIRONMENT=uat`/`prd` | Khi build dừng: **Proceed → FULL_CICD → Proceed → gõ `main` → Proceed** |
| **E** | dùng `*-dr` thay `*-dc` | `DR_VAULT_ADDR/TOKEN` + `DR_KUBE_CONFIG_FILE=dr-kubeconfig` (KHÔNG điền `DC_*`) |
| **F–I** | thêm các stage `unit-test-dc, configure-dc, replace-vault-pipeline, workflow-process-pipeline` | ⚠️ Unit Test sẽ FAIL ở bước gửi log webhook nếu `TEAMS_WEBHOOK_URL` rỗng (đã biết) — nói trước để khỏi bỡ ngỡ |

### Bước 3 — Chứng minh thành công (Ctrl+F trong Console)

- **A/C/D**: `naming to registry.gitlab.com/.../techshop:dev-XX done` + `Build and push image success` + `Finished: SUCCESS`
- **B/E**: `secret/env-file-secret created` + `secret/config-env-secret created` + `deployment "techshop-dev-deployment" successfully rolled out`
- **C**: `Trigger CD client success` + job `client-sink` có build mới

> Mẹo nhớ nhanh: **A** chỉ build → **B** tự deploy (DC) → **C** build xong bắn client → **D** UAT có hộp chọn → **E** deploy DR → **F–I** chạy "chiêu trò" nâng cao. Cứ giữ `VAULT_PATH=secret/techshop` + `BRANCH_CODE=main` + `SOURCE_CODE_PATH=vinh25042005/techshop-app` cho mọi kịch bản là đỡ lệch.

---

## 7. Mẹo & lưu ý

- Đọc kết quả nhanh nhất bằng **màu Stage View**: xanh = OK, đỏ = lỗi, xám = bỏ qua, vàng = đang chạy.
- Dùng **Console Output + Ctrl+F** để tìm dòng chứng minh: `naming to ... done`, `secret/... created`, `successfully rolled out`, `Finished: SUCCESS`.
- Các ô dạng danh sách (`ENABLED_STAGES`, `CLIENT_ENABLED_STAGES`, `*_SECRET_VAULT`, `*_LOCATION_VAULT`, `*_SECRET_NAME`) nhập **dạng JSON** có ngoặc vuông: `["a","b"]`.
- Các ô nhận **tên credential** (VD `gitlab-token`) chứ không phải giá trị secret — Jenkins tự tra credential khi chạy.
- Quy ước tên pipeline tự đặt: namespace `<project>-<env>-ns`, deployment `<project>-<env>-deployment`, container `<project>-<env>-container`.
- **Không sửa file pipeline `CICD-AIO-Jenkins.groovy`** — mọi việc chỉ là điền form trên giao diện.
