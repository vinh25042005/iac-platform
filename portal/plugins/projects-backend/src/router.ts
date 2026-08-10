import { HttpAuthService } from '@backstage/backend-plugin-api';
import { InputError } from '@backstage/errors';
import { z } from 'zod/v3';
import express from 'express';
import Router from 'express-promise-router';
import { ProjectStoreService } from './services/ProjectStoreService';
import { IacRunner } from './services/IacRunner';

export async function createRouter({
  httpAuth,
  store,
  iac,
}: {
  httpAuth: HttpAuthService;
  store: ProjectStoreService;
  iac: IacRunner;
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
    keyName: z
      .string()
      .default('techshop-key')
      .transform(s => s.trim())
      .refine(s => s.length > 0, { message: 'keyName không được để trống' }),
    status: z.enum(['active', 'archived']).optional().default('active'),
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
    const created = await store.createProject(parsed.data);

    // Tự sinh IaC vào thư mục iac-platform (new-project.sh — local, không push)
    let generatedFiles: string[] = [];
    let generateError: string | undefined;
    try {
      generatedFiles = await iac.generate(created.slug, undefined, parsed.data.keyName);
    } catch (e: any) {
      generateError = e.message;
    }

    res.status(201).json({ ...created, generatedFiles, generateError });
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
    await store.deleteProject(req.params.id);
    res.status(204).end();
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
