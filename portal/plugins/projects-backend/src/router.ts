import { HttpAuthService } from '@backstage/backend-plugin-api';
import { ConflictError, InputError } from '@backstage/errors';
import { z } from 'zod/v3';
import express from 'express';
import Router from 'express-promise-router';
import { ProjectStoreService } from './services/ProjectStoreService';
import { IacRunner } from './services/IacRunner';
import { VaultService } from './services/VaultService';
import { JenkinsService } from './services/JenkinsService';
import { ProjectConfigService } from './services/ProjectConfigService';

export async function createRouter({
  httpAuth,
  store,
  iac,
  vault,
  jenkins,
  config,
}: {
  httpAuth: HttpAuthService;
  store: ProjectStoreService;
  iac: IacRunner;
  vault: VaultService;
  jenkins: JenkinsService;
  config: ProjectConfigService;
}): Promise<express.Router> {
  const router = Router();
  router.use(express.json());

  // ── Project schema ──
  const projectSchema = z.object({
    name: z.string().min(1),
    // Slug bắt buộc chuẩn hoá: lowercase + bỏ space/ký tự lạ, chỉ giữ a-z0-9-
    // (chặn lỗi "only alphanumeric characters and hyphens allowed in name")
    slug: z
      .string()
      .min(1)
      .transform(s =>
        s
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/^-+|-+$/g, ''),
      )
      .refine(s => s.length > 0, { message: 'Slug không hợp lệ sau khi chuẩn hoá' }),
    owner: z.string().min(1),
    kickoffDate: z.string().optional().default(''),
    jiraKey: z.string().optional().default(''),
    jenkinsInstance: z.string().optional().default(''),
    // GitOps repo chứa helm chart + argocd apps — điền khi tạo project.
    // Mặc định iac-platform (repo có helm/_base). ArgoCD app dùng làm repoURL.
    repoUrl: z
      .string()
      .optional()
      .default('https://github.com/vinh25042005/iac-platform.git'),
    // Cụm kubeadm: tổng số node + node nào làm master (UI tạo project chọn)
    nodeCount: z.coerce.number().int().min(1).max(9).optional().default(3),
    masterNodeIndex: z.coerce.number().int().min(0).max(8).optional().default(0),
    // Loại máy EC2 (t3.small/t3.medium/t3.large...) — chọn trên UI khi tạo
    instanceType: z.string().optional().default('t3.small'),
    // ── Jenkins job params default (hiển thị sẵn trên Jenkins UI) ──
    appRepo: z.string().optional().default(''),
    registryBase: z.string().optional().default('docker.io/vinh2504'),
    imageRepoPrefix: z.string().optional().default(''),
    vaultEip: z.string().optional().default('52.221.18.86'),
    // Phải khớp targetRevision trong argocd/root.yaml (ArgoCD đang track branch này)
    deployBranch: z.string().optional().default('week-6-argo-rollouts'),
    keyName: z
      .string()
      .default('techshop-key')
      .transform(s => s.trim())
      .refine(s => s.length > 0, { message: 'keyName không được để trống' }),
    status: z.enum(['active', 'archived']).optional().default('active'),
    // Môi trường + service được chọn trong wizard Add Project
    envs: z
      .array(z.enum(['dev', 'stg', 'prd']))
      .optional()
      .default(['dev', 'stg', 'prd']),
    services: z
      .array(z.string())
      .optional()
      .default(['backend', 'frontend', 'database']),
  });

  const jenkinsSchema = z.object({
    name: z.string().min(1),
    url: z.string().min(1),
  });

  // ── Projects CRUD ──
  router.get('/projects', async (_req, res) => {
    res.json(await store.listProjects());
  });

  router.get('/projects/:id', async (req, res) => {
    res.json(await store.getProject(req.params.id));
  });

  router.post('/projects', async (req, res) => {
    const parsed = projectSchema.safeParse(req.body);
    if (!parsed.success) throw new InputError(parsed.error.toString());
    await httpAuth.credentials(req, { allow: ['user'] });
    // Bắt lỗi trùng slug (UNIQUE constraint) → trả 409 thông báo rõ thay vì 500
    let created: import('./services/ProjectStoreService').Project;
    try {
      created = await store.createProject(parsed.data);
    } catch (e: any) {
      if (String(e?.code ?? '').includes('SQLITE_CONSTRAINT')) {
        throw new ConflictError(
          `Slug "${parsed.data.slug}" đã tồn tại — hãy chọn slug khác`,
        );
      }
      throw e;
    }

    // Tự sinh IaC vào thư mục iac-platform (new-project.sh — local, không push)
    // Chỉ sinh các env được chọn trong wizard Add Project.
    // Truyền repoUrl làm GIT_ORIGIN → argocd/apps/<slug>-<env>.yaml có repoURL đúng
    // (không còn placeholder <your-org>) — project tạo xong là deploy được ngay.
    let generatedFiles: string[] = [];
    let generateError: string | undefined;
    try {
      generatedFiles = await iac.generate(
        created.slug,
        parsed.data.envs,
        parsed.data.keyName,
        created.repoUrl,
        created.nodeCount,
        created.masterNodeIndex,
        created.services,
        created.instanceType,
        created.registryBase,
        created.imageRepoPrefix,
      );
    } catch (e: any) {
      generateError = e.message;
    }

    // Tự tạo Jenkins job cho project (best-effort — không chặn việc tạo project)
    let jenkinsJob: string | undefined;
    let jenkinsError: string | undefined;
    try {
      if (jenkins.enabled) {
        jenkinsJob = await jenkins.createProjectJob(created.slug, {
          vaultDbPath: `secret/${created.slug}/${created.envs[0] ?? 'dev'}`,
          gitOpsRepo: created.repoUrl,
          appRepo: created.appRepo || undefined,
          registryBase: created.registryBase || undefined,
          imageRepoPrefix: created.imageRepoPrefix || undefined,
          vaultEip: created.vaultEip || undefined,
          deployBranch: created.deployBranch || undefined,
        });
      } else {
        jenkinsError = 'Jenkins chưa cấu hình — set JENKINS_USER + JENKINS_TOKEN';
      }
    } catch (e: any) {
      jenkinsError = e.message;
    }

    res.status(201).json({
      ...created,
      generatedFiles,
      generateError,
      jenkinsJob,
      jenkinsError,
    });
  });

  // ── Generate IaC thủ công (chạy lại new-project.sh) ──
  // LƯU Ý: phải truyền keyName của project — nếu không, new-project.sh fallback
  // về <project>-key (key KHÔNG tồn tại trên AWS → lỗi InvalidKeyPair.NotFound)
  router.post('/projects/:id/generate', async (req, res) => {
    await httpAuth.credentials(req, { allow: ['user'] });
    const project = await store.getProject(req.params.id);
    const files = await iac.generate(project.slug, undefined, project.keyName);
    res.json({ ok: true, files });
  });

  // ── Apply: chạy terraform apply cho 1 env (job nền, poll log) ──
  router.post('/projects/:id/apply', async (req, res) => {
    const parsed = z
      .object({ env: z.string().min(1) })
      .safeParse(req.body);
    if (!parsed.success) throw new InputError(parsed.error.toString());
    await httpAuth.credentials(req, { allow: ['user'] });
    const project = await store.getProject(req.params.id);
    const jobId = iac.startApply(project.slug, parsed.data.env);
    res.status(201).json({ jobId });
  });

  // ── Destroy: chạy terraform destroy cho 1 env (job nền, poll log) ──
  router.post('/projects/:id/destroy', async (req, res) => {
    const parsed = z
      .object({ env: z.string().min(1) })
      .safeParse(req.body);
    if (!parsed.success) throw new InputError(parsed.error.toString());
    await httpAuth.credentials(req, { allow: ['user'] });
    const project = await store.getProject(req.params.id);
    const jobId = iac.startDestroy(project.slug, parsed.data.env);
    res.status(201).json({ jobId });
  });

  // ── INIT / PLAN: terraform init / plan (job nền, poll log như apply) ──
  router.post('/projects/:id/init', async (req, res) => {
    const parsed = z
      .object({ env: z.string().min(1) })
      .safeParse(req.body);
    if (!parsed.success) throw new InputError(parsed.error.toString());
    await httpAuth.credentials(req, { allow: ['user'] });
    const project = await store.getProject(req.params.id);
    res.status(201).json({ jobId: iac.startInit(project.slug, parsed.data.env) });
  });

  router.post('/projects/:id/plan', async (req, res) => {
    const parsed = z
      .object({ env: z.string().min(1) })
      .safeParse(req.body);
    if (!parsed.success) throw new InputError(parsed.error.toString());
    await httpAuth.credentials(req, { allow: ['user'] });
    const project = await store.getProject(req.params.id);
    res.status(201).json({ jobId: iac.startPlan(project.slug, parsed.data.env) });
  });

  // ── ENV VARS: Vault secrets (Global Application Secrets) ──
  router.get('/projects/:id/vault/secrets', async (req, res) => {
    await httpAuth.credentials(req, { allow: ['user'] });
    const project = await store.getProject(req.params.id);
    const env = String(req.query.env ?? 'dev');
    const info = await vault.list(project.slug, env);
    res.json({
      addr: info.addr,
      path: info.path,
      version: info.version,
      data: info.data,
    });
  });

  router.post('/projects/:id/vault/secrets', async (req, res) => {
    const parsed = z
      .object({ env: z.string().min(1), data: z.record(z.string(), z.string()) })
      .safeParse(req.body);
    if (!parsed.success) throw new InputError(parsed.error.toString());
    await httpAuth.credentials(req, { allow: ['user'] });
    const project = await store.getProject(req.params.id);
    await vault.push(project.slug, parsed.data.env, parsed.data.data);
    res.json({ ok: true });
  });

  router.post('/projects/:id/vault/sync', async (req, res) => {
    const parsed = z
      .object({ env: z.string().min(1), namespace: z.string().optional() })
      .safeParse(req.body);
    if (!parsed.success) throw new InputError(parsed.error.toString());
    await httpAuth.credentials(req, { allow: ['user'] });
    const project = await store.getProject(req.params.id);
    const ns = parsed.data.namespace ?? `${project.slug}-${parsed.data.env}`;
    const result = await vault.syncToK8s(project.slug, parsed.data.env, ns);
    res.json({ ok: true, ...result });
  });

  // ── Liệt kê các job apply/destroy (còn trong bộ nhớ) ──
  // LƯU Ý: phải khai báo TRƯỚC '/apply/:jobId' — nếu không Express khớp
  // 'jobs' với ':jobId' → báo "Apply job jobs not found" (route order bug).
  router.get('/apply/jobs', async (_req, res) => {
    res.json(iac.listJobs());
  });

  router.get('/apply/:jobId', async (req, res) => {
    res.json(iac.getJob(req.params.jobId));
  });

  router.put('/projects/:id', async (req, res) => {
    const parsed = projectSchema.partial().safeParse(req.body);
    if (!parsed.success) throw new InputError(parsed.error.toString());
    await httpAuth.credentials(req, { allow: ['user'] });
    res.json(await store.updateProject(req.params.id, parsed.data));
  });

  router.delete('/projects/:id', async (req, res) => {
    await httpAuth.credentials(req, { allow: ['user'] });
    const project = await store.getProject(req.params.id);
    // Xoá file IaC sinh ra trên máy (terraform/helm/argocd/ansible + registry)
    // — KHÔNG xoá hạ tầng AWS (bấm Destroy riêng nếu muốn)
    let removedFiles: string[] = [];
    let cleanupError: string | undefined;
    try {
      removedFiles = iac.removeProjectFiles(project.slug);
    } catch (e: any) {
      cleanupError = e.message;
    }
    await store.deleteProject(req.params.id);
    // Xoá Jenkins job tương ứng (best-effort)
    let jenkinsError: string | undefined;
    try {
      if (jenkins.enabled) await jenkins.deleteProjectJob(project.slug);
    } catch (e: any) {
      jenkinsError = e.message;
    }
    res.status(204).json({ removedFiles, cleanupError, jenkinsError });
  });

  // ── Cấu hình per project×env: NETWORK / PUBLISH / MONITOR (helm values) ──
  // GET: đọc values.yaml + values-<env>.yaml, trả config + NLB DNS (best-effort)
  router.get('/projects/:id/config', async (req, res) => {
    await httpAuth.credentials(req, { allow: ['user'] });
    const project = await store.getProject(req.params.id);
    const env = String(req.query.env ?? 'dev');
    res.json(await config.getConfig(project.slug, env));
  });

  // PUT: ghi patch vào values-<env>.yaml (shape giống helm values)
  router.put('/projects/:id/config', async (req, res) => {
    const parsed = z
      .object({
        env: z.string().min(1),
        patch: z.record(z.unknown()),
      })
      .safeParse(req.body);
    if (!parsed.success) throw new InputError(parsed.error.toString());
    await httpAuth.credentials(req, { allow: ['user'] });
    const project = await store.getProject(req.params.id);
    const file = config.updateConfig(project.slug, parsed.data.env, parsed.data.patch);
    res.json({ ok: true, file });
  });

  // PUBLISH: trạng thái DockerHub credential (secret/ci/dockerhub trong Vault)
  router.get('/projects/:id/publish/dockerhub', async (req, res) => {
    await httpAuth.credentials(req, { allow: ['user'] });
    const project = await store.getProject(req.params.id);
    const info = await vault.readPath('secret/ci/dockerhub');
    res.json({
      path: 'secret/ci/dockerhub',
      version: info.version,
      exists: info.exists,
      data: info.data,
    });
  });

  // ── Jenkins job theo project — tạo tự động khi tạo project, quản lý tay ở đây ──
  router.get('/projects/:id/jenkins/job', async (req, res) => {
    await httpAuth.credentials(req, { allow: ['user'] });
    const project = await store.getProject(req.params.id);
    res.json(await jenkins.getJobStatus(project.slug));
  });

  router.post('/projects/:id/jenkins/job', async (req, res) => {
    await httpAuth.credentials(req, { allow: ['user'] });
    const project = await store.getProject(req.params.id);
    const name = await jenkins.createProjectJob(project.slug, {
      vaultDbPath: `secret/${project.slug}/${project.envs[0] ?? 'dev'}`,
    });
    res.status(201).json({ ok: true, name, ...(await jenkins.getJobStatus(project.slug)) });
  });

  router.delete('/projects/:id/jenkins/job', async (req, res) => {
    await httpAuth.credentials(req, { allow: ['user'] });
    const project = await store.getProject(req.params.id);
    await jenkins.deleteProjectJob(project.slug);
    res.json({ ok: true });
  });

  router.post('/projects/:id/jenkins/build', async (req, res) => {
    const parsed = z
      .object({
        env: z.string().default('dev'),
        mode: z.enum(['full', 'ci', 'release']).default('full'),
      })
      .safeParse(req.body);
    if (!parsed.success) throw new InputError(parsed.error.toString());
    await httpAuth.credentials(req, { allow: ['user'] });
    const project = await store.getProject(req.params.id);
    const name = jenkins.jobName(project.slug);
    await jenkins.triggerBuild(name, {
      ENV: parsed.data.env,
      MODE: parsed.data.mode,
      PROJECT_NAME: project.slug,
    });
    res.status(201).json({ ok: true, name });
  });

  router.get('/projects/:id/jenkins/builds/:number/log', async (req, res) => {
    await httpAuth.credentials(req, { allow: ['user'] });
    const project = await store.getProject(req.params.id);
    const log = await jenkins.getBuildLog(project.slug, Number(req.params.number));
    res.json({ log });
  });

  // ── Jenkins instances ──
  router.get('/jenkins', async (_req, res) => {
    res.json(await store.listJenkins());
  });

  router.post('/jenkins', async (req, res) => {
    const parsed = jenkinsSchema.safeParse(req.body);
    if (!parsed.success) throw new InputError(parsed.error.toString());
    await httpAuth.credentials(req, { allow: ['user'] });
    res.status(201).json(await store.createJenkins(parsed.data));
  });

  return router;
}
