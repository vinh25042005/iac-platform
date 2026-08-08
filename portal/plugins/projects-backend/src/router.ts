import { HttpAuthService } from '@backstage/backend-plugin-api';
import { InputError } from '@backstage/errors';
import { z } from 'zod/v3';
import express from 'express';
import Router from 'express-promise-router';
import { ProjectStoreService } from './services/ProjectStoreService';

export async function createRouter({
  httpAuth,
  store,
}: {
  httpAuth: HttpAuthService;
  store: ProjectStoreService;
}): Promise<express.Router> {
  const router = Router();
  router.use(express.json());

  // ── Project schema ──
  const projectSchema = z.object({
    name: z.string().min(1),
    slug: z.string().min(1),
    owner: z.string().min(1),
    kickoffDate: z.string().optional().default(''),
    jiraKey: z.string().optional().default(''),
    jenkinsInstance: z.string().optional().default(''),
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
    res.status(201).json(created);
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
