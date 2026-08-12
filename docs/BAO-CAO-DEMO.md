# 📋 Báo cáo dự án — iac-platform (BÁO CÁO DEMO MENTOR)

> Báo cáo chi tiết TỪNG LUỒNG của nền tảng: khi bấm nút nào trên UI thì hệ thống
> làm gì, chạy lệnh gì, tạo file gì, kết quả ra sao. Dùng để demo + trả lời câu
> hỏi "đoạn này luồng như nào, dùng lệnh gì".

---

## 1. TỔNG QUAN KIẾN TRÚC

```
┌──────────────────────────────────────────────────────────────────────┐
│                         BACKSTAGE PORTAL (UI)                        │
│  portal/ (yarn start) — frontend :3005, backend :7007               │
│  Plugin: projects (frontend) + projects-backend (backend)           │
└───────┬──────────────────────────────┬──────────────────────────────┘
        │  HTTP /api/projects-backend/* │
        ▼                              ▼
┌───────────────┐              ┌──────────────────┐
│  SQLite (DB)  │              │   JenkinsServer  │  EC2 (techshop-jenkins)
│  projects     │              │  47.130.241.226  │  port 9090 → docker jenkins
│  jenkins_inst │              │  job <slug>-ci   │  SCM Jenkinsfile từ deploy-web
└───────────────┘              └────────┬─────────┘
        │                              │ Vault AppRole
        ▼                              ▼
┌──────────────────┐            ┌──────────────────┐
│   Vault Server   │            │     AWS (TF)     │
│  52.221.18.86    │            │  S3 state + EC2  │
│  secret/<slug>/<env>          │  + NLB + VPC/SG  │
└──────────────────┘            └────────┬─────────┘
                                         ▼
                              ┌─────────────────────┐
                              │  Kubernetes cluster  │  kubeadm (1 master + N worker)
                              │  F5 ingress + ArgoCD │  helm/_cluster (kube-prometheus,
                              │  + Prometheus/Grafana│  nginx-ingress F5, ebs-csi, argo-rollouts)
                              └─────────────────────┘
```

**Các thành phần chính:**
- **Portal**: Backstage app — 1 frontend plugin (`projects`) + 1 backend plugin (`projects-backend`).
- **Backend plugin** gồm các service:
  - `ProjectStoreService` — SQLite (projects, jenkins_instances, iac_artifacts)
  - `IacRunner` — chạy terraform (init/plan/apply/destroy) dạng job nền
  - `VaultService` — đọc/ghi secrets trên Vault, sync sang K8s
  - `JenkinsService` — tạo/quản lý Jenkins job per project
  - `ProjectConfigService` — đọc/ghi helm values per project×env (NETWORK/PUBLISH/MONITOR)
- **IaC repo** (`iac-platform`): chứa `terraform/`, `helm/`, `argocd/`, `ansible/`, `scripts/`.

---

## 2. LUỒNG TẠO PROJECT MỚI (nút "+ Add Project")

### 2.1 UI — Create Project Page (3 bước wizard)
File: `portal/plugins/projects/src/components/CreateProjectPage/CreateProjectPage.tsx`

| Bước | Nhập gì | Ghi chú |
|---|---|---|
| 1. Project Details | Name, Namespace(slug), Owner, AWS Key Pair, Status, **GitOps Repo URL**, **Số node + Node master + Loại máy (instanceType)**, **Jenkins Pipeline Defaults** (APP_REPO/REGISTRY_BASE/IMAGE_REPO_PREFIX/VAULT_EIP/DEPLOY_BRANCH), Jenkins Instance | Slug tự chuẩn hoá (lowercase, bỏ ký tự lạ) |
| 2. Environments & Services | dev/stg/prd + backend/frontend/database/**rancher** | Mỗi env = 1 cluster riêng; chọn **rancher** → tạo EC2 riêng chạy Rancher Server (ngoài cụm K8s, quản lý cluster qua kubeconfig) |
| 3. Integration & Review | Vault Profile, Registry URL, Review | Xem lại rồi bấm Create |

**Bấm "Create Project" →** frontend gọi:
```
POST plugin://projects-backend/projects
body: { name, slug, owner, keyName, status, repoUrl, jenkinsInstance, envs, services }
```

### 2.2 Backend — router.ts `POST /projects`
Đây là **mấu chốt của toàn bộ platform** — 1 request sinh ra CẢ CÂY hạ tầng. Thứ tự:

```
1. Validate zod schema (slug chuẩn hoá a-z0-9-)
2. store.createProject()          → ghi SQLite (bảng projects)
3. iac.generate(slug, envs, keyName, repoUrl)
   └─ chạy:  bash scripts/new-project.sh <slug>
      env:   ENVS="dev stg prd"  KEY_NAME=techshop-key  GIT_ORIGIN=<repoUrl>
4. jenkins.createProjectJob(slug, {vaultDbPath, gitOpsRepo})
   └─ gọi Jenkins REST: POST /createItem?name=<slug>-ci  (XML pipeline job)
5. Trả về 201: { ...project, generatedFiles, jenkinsJob, jenkinsError }
```

### 2.3 scripts/new-project.sh sinh NHỮNG file gì
File: `scripts/new-project.sh` — chạy local, KHÔNG push GitHub.

```
[1/4] terraform/environments/<slug>/{dev,stg,prd}/
        main.tf      (copy từ _template, thay state key = <slug>/<env>/terraform.tfstate)
        variables.tf
        terraform.tfvars  (project, env, key_name,
                           instance_type=<chọn trên UI: t3.small/medium/large...>,
                           node_count=<N>  ← tổng số node (UI chọn)
                           master_node_index=<i>  ← node nào làm master (UI chọn))
[2/4] helm/_base/values/<slug>/
        values.yaml      (global.project = <slug>)
        values-dev.yaml  values-stg.yaml  values-prd.yaml
[3/4] argocd/apps/<slug>-<env>.yaml   (MỖI env 1 file)
        repoURL = GIT_ORIGIN   ← repoUrl điền lúc tạo project (KHÔNG còn placeholder)
        path    = helm/_base
        valueFiles = values/<slug>/values.yaml + values-<env>.yaml
        namespace = <slug>-<env>  (CreateNamespace=true)
[4/4] projects.txt  ← thêm dòng <slug>
```

### 2.4 JenkinsService.createProjectJob tạo job gì
Gọi Jenkins API (basic auth admin:token + CSRF crumb):
```
POST http://47.130.241.226:9090/createItem?name=<slug>-ci
body: config.xml (flow-definition / WorkflowJob)
```
Job có:
- **SCM**: clone `https://github.com/vinh25042005/deploy-web.git` (branch `week-6-argo-rollouts`), scriptPath `Jenkinsfile` → **Jenkinsfile GENERIC chạy được mọi project**.
- **Params** (default theo project — điền trên UI khi tạo): `PROJECT_NAME=<slug>`, `APP_REPO` (UI), `REGISTRY_BASE` (UI), `IMAGE_REPO_PREFIX` (UI), `VAULT_DB_PATH=secret/<slug>/<env>`, `VAULT_EIP` (UI), `DEPLOY_BRANCH` (UI), `GIT_OPS_REPO=<repoUrl>`, `ENV`, `MODE`, `ENABLED_STAGES`, các boolean SKIP_*.
  → Các giá trị này hiển thị sẵn trong Jenkins UI khi mở job (có thể đổi lại lúc build).

**Kết quả demo được**: tạo project `demotest` → file `argocd/apps/demotest-dev.yaml` có
`repoURL: https://github.com/vinh25042005/iac-platform.git`, job `demotest-ci` xuất hiện trên Jenkins.

---

## 3. LUỒNG APPLY (nút "APPLY" trong tab INFRA)

### 3.1 UI
File: `EnvConfigWizard.tsx` → bấm APPLY → mở `ApplyLogDialog` (poll job mỗi 2s).
Frontend gọi:
```
POST plugin://projects-backend/projects/:id/apply  { env: "dev" }
→ 201 { jobId: "apply-..." }
GET  /apply/:jobId   (poll liên tục để render log realtime)
```

### 3.2 Backend — IacRunner.startJob (job nền)
```
cd terraform/environments/<slug>/<env>
terraform init -reconfigure -input=false -no-color          (nạp backend S3)
terraform apply -auto-approve -input=false -no-color
```
- Job chạy **nền** (child_process), log đẩy dần vào `job.logs[]`, frontend poll.
- Có **lock** (`#locks` map) chặn 2 job cùng chạy trên 1 project/env.
- `mode` = init | plan | apply | destroy (chỉ khác lệnh cuối).

### 3.3 Terraform làm gì (terraform/environments/_template/main.tf)
```
module "network"     → VPC 2 tầng (public/private subnets) + NAT + SG (least privilege)
                       sg_allow_internal / sg_allow_api / sg_allow_web(80/443)
module "kubernetes"  → node_count node (t3.small), IAM role node_ssm
                       + kubeconfig upload SSM  →  /k8s/<project>-<env>/kubeconfig
                       node[master_node_index] = MASTER (public subnet, public IP — kubeadm init)
                       các node còn lại        = WORKER (private subnet, join qua bastion)
                       (UI tạo project chọn số node + node nào làm master)
module "rancher"     → (chỉ khi chọn service "rancher") EC2 t3.medium riêng chạy
                       rancher/rancher:v2.11.3 (Docker), SG mở 443 public.
                       Rancher NẰM NGOÀI CỤM K8s — quản lý cluster từ xa qua kubeconfig
                       (Rancher Import Cluster). URL: https://<public-ip> (admin/admin)
                       (v2.11.x hỗ trợ import K8s 1.30-1.32 — cluster dùng k8s 1.32)
aws_lb (ingress)     → NLB <project>-<env>-nlb, target group http+https trỏ thẳng vào node
                       (F5 ingress hostNetwork 80/443), health check path /healthz
null_resource.ansible → ansible-playbook k8s-cluster.yml (kubeadm init, Calico, join workers)
terraform_data.wait_k8s_api → chờ kubeconfig SSM + kubectl get ns OK
terraform_data.install_cluster_base → helm upgrade --install cluster-base helm/_cluster
```

### 3.4 helm/_cluster cài gì (1 lần mỗi cluster)
`helm/_cluster/Chart.yaml` — subcharts:
| Chart | Vai trò |
|---|---|
| `kube-prometheus-stack` | Prometheus + Grafana + ServiceMonitor + alert rules |
| `nginx-ingress` (F5) | NGINX Ingress Controller (daemonset, hostNetwork, /healthz) |
| `metrics-server` | HPA metrics |
| `aws-ebs-csi-driver` | StorageClass EBS cho Postgres PVC |
| `argo-rollouts` | Blue/Green + Canary deploy (Rollout CRD) |
| cert-manager | TẮT subchart (Ansible cài riêng) |

### 3.5 HOOK sau APPLY thành công → tự tạo Vault credentials
`IacRunner` có callback `onApplySuccess` (khai báo trong `plugin.ts`):
```
vault.ensureStandardSecrets(slug, env)
  → tạo (nếu chưa có) tại secret/<slug>/<env>:
      postgres_password (random 18)
      jwt_secret        (random 32)
      grafana_admin_user=admin
      grafana_admin_password (capture từ cluster-base-grafana secret, nếu không có → random 16)
  → idempotent: KHÔNG ghi đè key đã tồn tại
Log: "✅ Đã tự tạo credentials vào Vault (secret/f5test/dev): ..."
```

---

## 4. LUỒNG ENV VARS (Vault)

### 4.1 Mở tab ENV VARS
- Frontend `api.listVaultSecrets(id, env)` → backend `vault.list(slug, env)`
- `VaultService.#listPath` thử KV v2 (`secret/data/<slug>/<env>`) trước, fallback KV v1.
- Kết quả: `{ addr, path, version, data }` → hiện từng row secret.

### 4.2 Các nút
| Nút | Gọi | Backend làm |
|---|---|---|
| **Load from Vault** | GET /vault/secrets | Đọc lại secrets từ Vault |
| **Push to Vault** | POST /vault/secrets `{env, data}` | Ghi đè toàn bộ secret path |
| **Sync to K8s** | POST /vault/sync `{env, namespace}` | Tạo namespace nếu chưa có → `kubectl apply` Secret `<slug>-<env>-secrets` |

Lưu ý kỹ thuật: Vault dùng TLS self-signed → `VaultService.#req` dùng node:https với
`rejectUnauthorized:false`. `kubectl` có timeout (tránh treo khi cluster chết).

---

## 5. LUỒNG PIPELINE (Jenkins CI/CD) — bấm "▶ Build"

### 5.1 UI (JenkinsPanel)
File: `portal/plugins/projects/src/components/JenkinsPanel/JenkinsPanel.tsx`
- Hiển thị: job `<slug>-ci` (đã tạo/chưa), builds gần đây, nút Log.
- Chọn ENV (dev/stg/prd) + MODE (full/ci/release) → bấm Build.
- Gọi: `POST /projects/:id/jenkins/build  {env, mode}` → backend `jenkins.triggerBuild()`.

### 5.2 Backend triggerBuild
```
POST http://47.130.241.226:9090/job/<slug>-ci/buildWithParameters
      ?ENV=dev&MODE=full&PROJECT_NAME=<slug>
(có CSRF crumb: GET /crumbIssuer/api/json)
```

### 5.3 Jenkins chạy Jenkinsfile GENERIC (từ deploy-web SCM)
Các stage (theo `ENABLED_STAGES`):
```
1. Initialization          — đặt tên build, tag image (dev-<n>)
2. Resolve ENV             — ACTIVE_ENV, IMAGE_TAG, branch
3. Select Execution Mode   — full/ci/release
4. Get Release Info        — in thông tin build
5. Fetch Secrets from Vault — HashiCorp Vault Plugin (AppRole vault-approle-jenkins)
                              đọc: secret/ci/github, secret/ci/dockerhub, secret/ci/sonar,
                                   secret/ci/cosign, secret/cosign, VAULT_DB_PATH (password)
6. Fetch Kubeconfig (SSM)  — [MỚI FIX] thử /k8s/<PROJECT>-<ENV>/kubeconfig
                              trước, fallback /k8s/kubeconfig → base64 -d | gunzip > ~/.kube/config
7. Rotate DB Password      — (chỉ khi ROTATE_DB_PASSWORD=true)
8. Reconcile Cluster Secrets — kubectl sync dockerhub-secret (imagePullSecret)
                              + cosign-pub (Kyverno verify) từ Vault
9. Clone App Source        — git clone APP_REPO
10. SonarQube             — scan (JS/TS), gửi kết quả lên Sonar :9000
11. Build & Push Backend/Frontend — docker build + docker push (frontend:dev-4)
12. Scan Backend/Frontend  — (trivy/scan)
13. Sign & Attest (Cosign) — ký image + SLSA provenance
14. Verify Image (cosign)  — verify signature
15. Cleanup Docker Images  — giữ 3 image mới nhất
16. Commit GitOps Manifest — ghi helm/<PROJECT>/.argocd-source-<PROJECT>-<ENV>.yaml
                              (images.backend/frontend = tag mới) → git push deploy-web
post: success → "✅ CI thành công [full]! ArgoCD sẽ deploy dev @ dev-4"
```

### 5.4 ArgoCD deploy
- ArgoCD (đã cài qua cluster-base) đọc **Application** (argocd/apps/<slug>-<env>.yaml)
  trỏ `repoURL=iac-platform` + path `helm/_base` + values per project.
- Khi Jenkins commit `.argocd-source-<slug>-<env>.yaml` lên deploy-web → ArgoCD (hoặc
  app-of-apps) sync → deploy Rollout (backend/frontend) vào namespace `<slug>-<env>`.

---

## 6. LUỒNG DESTROY (nút "DESTROY")
- Frontend `destroyProject(id, env)` → backend `iac.startDestroy()`.
- `terraform destroy -auto-approve` → xoá toàn bộ: VPC, subnets, SG, nodes, NLB,
  IAM role, cluster-base helm release.
- Kết quả: `Destroy complete! Resources: 39 destroyed.` (đã xác minh thật trên AWS).

---

## 7. LUỒNG XOÁ PROJECT (nút 🗑)
Backend `DELETE /projects/:id`:
1. `iac.removeProjectFiles(slug)` — xoá file local:
   - `terraform/environments/<slug>/`
   - `helm/_base/values/<slug>/`
   - `argocd/apps/<slug>-*.yaml`
   - `ansible/inventories/<slug>-*.ini`
   - gỡ dòng `<slug>` khỏi `projects.txt`
2. `store.deleteProject(id)` — xoá khỏi SQLite.
3. `jenkins.deleteProjectJob(slug)` — `POST /job/<slug>-ci/doDelete` trên Jenkins.
> KHÔNG tự destroy hạ tầng AWS — phải bấm Destroy riêng.

---

## 8. LUỒNG CÁC TAB CẤU HÌNH (NETWORK / PUBLISH / MONITOR)

### 8.1 Backend ProjectConfigService
- Đọc: merge `helm/_base/values/<slug>/values.yaml` + `values-<env>.yaml` (js-yaml deep-merge).
- Ghi: chỉ ghi vào `values-<env>.yaml` (giữ nguyên file base + comments).
- NLB DNS: query AWS `aws elbv2 describe-load-balancers --names <slug>-<env>-nlb`.

### 8.2 Tab NETWORK
- Hiển thị: ingress class, host, TLS, clusterIssuer, **NLB DNS** (nếu đã apply).
- Save → PUT `/projects/:id/config` patch `{ingress: {...}}` → ghi vào `values-<env>.yaml`.
- Nếu chưa có NLB: hiện banner "chạy INFRA → APPLY".

### 8.3 Tab PUBLISH
- Registry/tag → patch `{images: {repo, tag}}`.
- DockerHub credential: GET `/projects/:id/publish/dockerhub` → đọc `secret/ci/dockerhub`
  trong Vault (username + token) — hiển thị trạng thái.

### 8.4 Tab MONITOR
- Grafana host, Prometheus address, ruleGroup, HPA (min/max/targetCPU)
  → patch `{monitoring: {...}, hpa: {...}}`.

---

## 9. CÁC LỆNH / FILE QUAN TRỌNG (hỏi vặn hay gặp)

### Lệnh
| Việc | Lệnh |
|---|---|
| Start portal | `cd portal && yarn start` (frontend :3005, backend :7007) |
| Sinh project thủ công | `./scripts/new-project.sh <proj>` hoặc `make new-project PROJ=x` |
| Terraform apply | `make apply PROJ=x ENV=dev` |
| Terraform plan | `make plan PROJ=x ENV=dev` |
| Khởi tạo state bucket | `./scripts/env-init.sh` / `make init` |
| SSH Jenkins VM | `ssh -i ~/.ssh/techshop-key.pem ubuntu@47.130.241.226` |
| Jenkins API check | `curl -u 'admin:<token>' http://47.130.241.226:9090/api/json` |
| Vault list | `curl -sk -H "X-Vault-Token: $VT" https://52.221.18.86:8200/v1/secret/metadata/<slug>` |
| Kubeconfig từ SSM | `aws ssm get-parameter --name /k8s/<proj>-<env>/kubeconfig --with-decryption --query Parameter.Value --output text | base64 -d | gunzip` |
| Kubectl | `export KUBECONFIG=<kubeconfig file>` rồi `kubectl get nodes/pods/ns` |

### File đáng nhớ
| File | Vai trò |
|---|---|
| `scripts/new-project.sh` | Sinh toàn bộ scaffold project |
| `scripts/env-init.sh` | Tạo S3 state bucket (1 lần) |
| `terraform/environments/_template/main.tf` | Template cluster (network + k8s + NLB + ansible + cluster-base) |
| `terraform/modules/{network,kubernetes,database}/aws/` | Module dùng chung |
| `ansible/playbooks/k8s-cluster.yml` | kubeadm init + Calico + join workers |
| `helm/_cluster/` | Chart nền tảng (1 lần/cluster) |
| `helm/_base/` | Chart app generic (mọi project) |
| `argocd/apps/<slug>-<env>.yaml` | ArgoCD Application per env |
| `argocd/root.yaml` | App-of-apps (chưa cấu hình repo thật — TODO) |
| `Jenkinsfile` | Pipeline generic (SCM deploy-web) |
| `portal/plugins/projects/` | Frontend plugin |
| `portal/plugins/projects-backend/` | Backend plugin |

---

## 10. NHỮNG GÌ ĐÃ DEMO ĐƯỢC THẬT (E2E 2026-08-11)

Chạy trên project `f5test` (env dev), đã xác minh từng bước bằng screenshot
(trong `screenshots/e2e-20260811/`):

| Bước | Kết quả thật |
|---|---|
| APPLY | ✅ 39 resources, ~12 phút |
| Vault auto-secrets sau APPLY | ✅ tạo `secret/f5test/dev` |
| Sync Vault → K8s | ✅ Secret `f5test-dev-secrets` + namespace tự tạo |
| Cluster | ✅ 1 master + 2 worker (v1.32.13) Ready |
| NLB | ✅ `f5test-dev-nlb` active, target groups healthy |
| F5 Ingress | ✅ /healthz → HTTP 200 "healthy" |
| CI Build #4 | ✅ SUCCESS — push `deploy-web-frontend:dev-4` lên DockerHub |
| DESTROY | ✅ 39 destroyed (AWS sạch) |

### Các fix/lỗi phát hiện trong lúc demo (kể để ghi điểm)
1. **Sync Vault→K8s lỗi namespace** → fix `syncToK8s()` tự `kubectl create namespace`.
2. **Kubeconfig SSM mismatch** (global vs per-project) → fix Jenkinsfile ưu tiên
   `/k8s/<PROJECT>-<ENV>/kubeconfig`, fallback global (đã push deploy-web).
3. **ArgoCD repoURL placeholder** `<your-org>` → fix: thêm field **GitOps Repo URL**
   khi tạo project → repoURL đúng ngay từ đầu.

---

## 11. TODO / ĐIỂM CÒN THIẾU (trả lời thẳng khi mentor hỏi)
- **ArgoCD deploy end-to-end chưa chạy tới app**: `argocd/root.yaml` và app file đã
  đúng repoURL, nhưng cần push `argocd/apps/` lên GitHub + tạo Application (hoặc dùng
  app-of-apps root) để ArgoCD tự sync app xuống cluster. CI commit GitOps manifest
  đã hoạt động (`.argocd-source-f5test-dev.yaml`).
- `cert-manager` subchart tắt (Ansible cài riêng) — tài liệu hoá đầy đủ hơn.
- Backend build `false` cho f5test vì APP_REPO=techshop-app chỉ có frontend source.
- Jenkins job dùng 1 Jenkinsfile generic chung (deploy-web) — đúng thiết kế multi-project.

---

## 12. TRẢ LỜI CÂU HỎI MENTOR: "GỌI JENKINS/VAULT/AWS NHƯ NÀO, TÀI KHOẢN AWS NÀO?"

### Gọi Jenkins
- Backend (`JenkinsService.ts`) gọi **Jenkins REST API** qua HTTP:
  - URL: `JENKINS_URL` (mặc định `http://47.130.241.226:9090`)
  - Auth: `Authorization: Basic base64(JENKINS_USER:JENKINS_TOKEN)` (user `admin` + API token)
  - **CSRF crumb**: `GET /crumbIssuer/api/json` → gửi kèm `crumbRequestField`+`crumb` cho mọi POST.
  - Endpoints: `GET /job/<name>/api/json` (check), `POST /createItem?name=<slug>-ci` (tạo job, body config.xml), `POST /job/<name>/doDelete` (xoá), `POST /job/<name>/buildWithParameters?ENV=..&MODE=..` (trigger), `GET /job/<name>/<n>/consoleText` (log).
- SG Jenkins mở 9090 cho IP máy portal (`123.16.116.186/32`).

### Gọi Vault
- Backend (`VaultService.ts`) gọi **Vault HTTP API qua HTTPS**:
  - URL: `VAULT_ADDR` (`https://52.221.18.86:8200`), Header `X-Vault-Token: <VAULT_TOKEN>`.
  - TLS tự ký → `rejectUnauthorized:false`.
  - KV v2: đọc `GET /v1/secret/data/<slug>/<env>`, ghi `POST .../data/<slug>/<env>` (body `{data}`).
  - Jenkins đọc Vault trực tiếp qua AppRole `vault-approle-jenkins` (policy `techshop-ci`, đã thêm `secret/data/+/+`).

### Gọi AWS
- Backend **KHÔNG gọi AWS API trực tiếp** — chạy **terraform CLI** (`IacRunner.ts`):
  `cd terraform/environments/<slug>/<env> && terraform init -reconfigure && terraform apply/destroy -auto-approve`
- Terraform dùng **AWS credential chain của máy** (env → `~/.aws/credentials` → IAM role), spawn child với `env: process.env`.
- Backend cũng chạy `aws` CLI bổ trợ (tra NLB DNS, SSM kubeconfig).

### Tài khoản AWS nào? (câu quan trọng nhất)
- Máy chạy portal có `~/.aws/credentials` user `terraform-user` → `aws sts get-caller-identity`:
  `Account: 790400775134`, `Arn: arn:aws:iam::790400775134:user/terraform-user`, region `ap-southeast-1`.
- Backend S3 state: bucket `iac-platform-state-790400775134` (tên gắn số account) → Terraform init nạp state đúng account đó.
- Tên resources `<project>-<env>-*` (VD `f5test-dev-nlb`, `rctest-rancher`) → dễ nhận biết trên AWS console.
- Đổi account = đổi credentials trên máy (không hardcode ở đâu).

### IP máy đổi mạng thì sao? (Jenkins SG) — GIẢI PHÁP: SSH TUNNEL
- Vấn đề: Jenkins SG mở 9090 cho IP máy portal; IP động (nhà dân/wifi/4G) → đổi mạng = đổi IP → backend mất kết nối Jenkins.
- **Giải pháp chính (đã dùng): SSH tunnel** — vì Jenkins mở SSH 22 cho mọi IP (`0.0.0.0/0`), tunnel qua SSH là bền vững, IP đổi thế nào cũng chạy:
  - `scripts/start-jenkins-tunnel.sh [start|stop|restart|status]` — dựng tunnel trong **tmux session `jenkins-tunnel`**, chạy runner `~/.jenkins-tunnel-runner.sh` (lặp `ssh -N -L 9090:localhost:9090` với `ServerAliveInterval=30` → **tự reconnect khi mất kết nối**).
  - Backend dùng `JENKINS_URL=http://localhost:9090` (chạy qua tunnel) — đã xác minh end-to-end.
- Khởi động toàn bộ: `scripts/portal.sh [start|stop|status]` (tự dựng tunnel + chạy portal + đủ env).
- Phương án phụ (nếu không muốn tunnel): `scripts/allow-portal-ip.sh` — tự cập nhật SG theo IP hiện tại (giữ rule GitHub).

---

## 13. LỜI KHUYÊN DEMO
1. **Mở portal** → tạo 1 project mới (khoe field GitOps Repo URL + tự sinh file + job Jenkins).
2. **Mở tab INFRA** → bấm APPLY → khoe log realtime + "tự tạo Vault credentials" khi xong.
3. **Tab ENV VARS** → Load/Push/Sync secret lên K8s.
4. **Tab NETWORK** → khoe NLB DNS hiển thị sau apply.
5. **Tab PIPELINE** → bấm Build → khoe build #N SUCCESS + log + image trên DockerHub.
6. **Tab PUBLISH** → khoe DockerHub credential đọc từ Vault thật.
7. **Tab MONITOR** → khoe Grafana/Prometheus/HPA config.
8. Kết thúc: bấm DESTROY → khoe "39 destroyed" (tiết kiệm chi phí).
```
