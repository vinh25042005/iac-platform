# Hướng dẫn tạo GitLab để chạy CICD-AIO-Jenkins.groovy (code cũ)

> Pipeline này BẮT BUỘC GitLab (checkout `https://oauth2:TOKEN@gitlab.com/...`).
> Các bước dưới đây để bạn có đủ: repo source + PAT + Container Registry + credential Jenkins.

## 1. Tạo GitLab account + repo source

1. Đăng ký / đăng nhập **https://gitlab.com** (hoặc GitLab nội bộ của công ty/trường).
2. **New project** → **Create blank project**:
   - Project name: `techshop-app` (hoặc tên app của bạn)
   - **Namespace**: tên bạn hoặc tạo 1 **Group** (VD: `vinh2504`)
   - Visibility: Private (khuyên dùng)
3. Đưa source app lên repo. Có 2 cách:

   **Cách A — Import từ GitHub (nhanh):**
   - New project → **Import project** → **GitHub** → chọn repo `techshop-app`.

   **Cách B — Push tay:**
   ```bash
   cd <thư mục source app>
   git remote add gitlab https://gitlab.com/<org>/techshop-app.git
   git push -u gitlab main
   ```

## 2. Tạo GitLab Personal Access Token (PAT)

1. GitLab → **Avatar (góc phải trên)** → **Preferences** → **Access Tokens**.
2. Điền:
   - Name: `jenkins-ci`
   - Expiration: tuỳ chọn (30 ngày...)
   - **Scopes**:
     - `read_repository` — **bắt buộc** (để clone source)
     - `write_repository` — nếu pipeline cần push (optional)
     - `read_registry` + `write_registry` — nếu dùng GitLab Container Registry
3. **Create personal access token** → **copy token ngay** (chỉ hiện 1 lần).

## 3. Bật GitLab Container Registry

1. Vào project → **Settings** → **General** → **Visibility, project features** → bật **Container registry**.
2. `REGISTRY_URL` của bạn sẽ là:
   ```
   registry.gitlab.com/<org>/<project>
   ```
3. Test login (trên máy có docker):
   ```bash
   docker login registry.gitlab.com -u <username> -p <PAT>
   ```
   → sinh `~/.docker/config.json` (chứa auth). **File này là `REGISTRY_AUTH`** trong Jenkins.

## 4. Nạp credential vào Jenkins

Vào **Manage Jenkins → Credentials → Global → Add Credentials**, tạo các loại sau:

| Credential | Loại | Giá trị | Truyền vào param |
|---|---|---|---|
| GitLab PAT | **Secret text** (hoặc Username+password) | PAT ở bước 2 | `GITLAB_ACCESS_TOKEN` |
| Docker config | **Secret file** | nội dung `~/.docker/config.json` (sau `docker login registry.gitlab.com`) | `REGISTRY_AUTH` |
| Vault token | **Secret text** | token Vault hiện tại (`hvs.32cgw...`) | `COMPANY_VAULT_TOKEN` |
| Jenkins client (nếu có giai đoạn CD) | Username+password | user + API token của Jenkins client | `JENKINS_CLIENT_USER` / `JENKINS_CLIENT_TOKEN` |
| Kubeconfig (nếu deploy DC/DR) | **Secret file** | nội dung kubeconfig | `DC_KUBE_CONFIG_FILE` / `DR_KUBE_CONFIG_FILE` |

## 5. Tạo job Jenkins chạy file này

1. Jenkins → **New Item** → **Pipeline**, đặt tên (VD: `app-aio-ci`).
2. **Pipeline**:
   - **Definition**: `Pipeline script`
   - **Script**: dán toàn bộ nội dung `CICD-AIO-Jenkins.groovy`
   - (Hoặc `Pipeline script from SCM` nếu file này nằm trong 1 repo — `Script Path = CICD-AIO-Jenkins.groovy`)
3. Lưu → **Build with Parameters** → điền.

## 6. Điền tham số khi chạy (giai đoạn 1 — company-side CI)

| Param | Giá trị |
|---|---|
| `PROJECT_NAME` | `techshop` (hoặc tên app) |
| `ENVIRONMENT` | `dev` |
| `LOCATION` | `company-side` |
| `SOURCE_CODE_PATH` | `<org>/techshop-app` (VD: `vinh2504/techshop-app`) |
| `BRANCH_CODE` | `main` |
| `GITLAB_ACCESS_TOKEN` | (credential ID bước 4) |
| `REGISTRY_URL` | `registry.gitlab.com/<org>/<project>` |
| `REGISTRY_AUTH` | (credential ID bước 4) |
| `COMPANY_VAULT_ADDR` | `https://52.221.18.86:8200` |
| `COMPANY_VAULT_TOKEN` | (credential ID bước 4) |
| `VAULT_PATH` | path secret app trong Vault (VD: `secret/data/techshop`) |
| `ENABLED_STAGES` | `["CheckSource", "GetVault", "build-push"]` (mặc định gốc: `["CheckSource","GetVault"]`) |
| `MODULE_DEPLOY` | `backend,frontend` (nếu dùng modular) |
| `TEAMS_WEBHOOK_URL` | để trống nếu chưa có |

> Giai đoạn 2+ (client-side / DC/DR / ERP) cần thêm: `JENKINS_CLIENT_URL/USER/TOKEN`, `DC/DR_KUBE_CONFIG_FILE`, `ERP_*`, `TEAMS_WEBHOOK_URL` — phần này cần hạ tầng bổ sung.

## Lưu ý
- Pipeline gốc build **1 image** từ `Dockerfile` gốc của repo (không tách backend/frontend riêng như Jenkinsfile hiện tại).
- Nếu GitLab nội bộ (không phải gitlab.com): sửa domain trong `checkoutSourceCode()` (`gitlab.com` → domain nội bộ).
- Vault: pipeline dùng `vault CLI` (login bằng token) — agent Jenkins phải có `vault` binary.
