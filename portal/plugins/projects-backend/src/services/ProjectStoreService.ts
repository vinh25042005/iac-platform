import {
  LoggerService,
  DatabaseService,
} from '@backstage/backend-plugin-api';
import { NotFoundError } from '@backstage/errors';

// =============================================================================
// ProjectStoreService — lưu project + jenkins instances vào SQLite
// (qua coreServices.database — Backstage tự quản lý schema + migration)
// =============================================================================

export interface Project {
  id: string;
  name: string;
  slug: string;
  owner: string;
  kickoffDate: string;
  jiraKey: string;
  jenkinsInstance: string;
  keyName: string;
  status: string; // active | archived
  // GitOps repo chứa helm chart + argocd apps (điền khi tạo project).
  // ArgoCD app + Jenkins dùng repo này. Mặc định iac-platform (repo có helm/_base).
  repoUrl: string;
  // Cụm kubeadm: tổng số node + node nào làm master (tùy chọn trên UI khi tạo).
  nodeCount: number;
  masterNodeIndex: number;
  // Loại máy EC2 (t3.small / t3.medium / t3.large...) — chọn trên UI khi tạo.
  instanceType: string;
  // ── Jenkins job params (default hiển thị sẵn trên Jenkins UI) ──
  appRepo: string;          // repo mã nguồn app → param APP_REPO
  registryBase: string;     // docker registry base → param REGISTRY_BASE
  imageRepoPrefix: string;  // tiền tố image → param IMAGE_REPO_PREFIX
  vaultEip: string;         // Vault EIP → param VAULT_EIP
  deployBranch: string;     // branch deploy-web ArgoCD track → param DEPLOY_BRANCH
  // Môi trường được chọn khi tạo project + các service (backend/frontend/database)
  envs: string[];
  services: string[];
}

export interface JenkinsInstance {
  name: string;
  url: string;
}

const TABLE_PROJECTS = 'projects';
const TABLE_JENKINS = 'jenkins_instances';
const TABLE_IAC = 'iac_artifacts';

export class ProjectStoreService {
  readonly #logger: LoggerService;
  readonly #database: DatabaseService;
  #client: any;

  private constructor(logger: LoggerService, database: DatabaseService) {
    this.#logger = logger;
    this.#database = database;
  }

  static async create(options: {
    logger: LoggerService;
    database: DatabaseService;
  }): Promise<ProjectStoreService> {
    const svc = new ProjectStoreService(options.logger, options.database);
    await svc.#init();
    return svc;
  }

  async #init() {
    const client = await this.#database.getClient();
    this.#client = client;

    const hasProjects = await client.schema.hasTable(TABLE_PROJECTS);
    if (!hasProjects) {
      await client.schema.createTable(TABLE_PROJECTS, table => {
        table.string('id').primary();
        table.string('name').notNullable();
        table.string('slug').notNullable().unique();
        table.string('owner').notNullable();
        table.string('kickoffDate');
        table.string('jiraKey');
        table.string('jenkinsInstance');
        table.string('keyName');
        table.string('status').notNullable().defaultTo('active');
      });
    }

    // Migration: thêm cột keyName cho bảng cũ (chưa có)
    const hasKeyName = await client.schema.hasColumn(TABLE_PROJECTS, 'keyName');
    if (!hasKeyName) {
      await client.schema.alterTable(TABLE_PROJECTS, table => {
        table.string('keyName');
      });
    }

    // Migration: thêm cột envs/services (JSON text) cho bảng cũ
    const hasEnvs = await client.schema.hasColumn(TABLE_PROJECTS, 'envs');
    if (!hasEnvs) {
      await client.schema.alterTable(TABLE_PROJECTS, table => {
        table.text('envs');
      });
    }
    const hasServices = await client.schema.hasColumn(TABLE_PROJECTS, 'services');
    if (!hasServices) {
      await client.schema.alterTable(TABLE_PROJECTS, table => {
        table.text('services');
      });
    }

    // Migration: thêm cột repoUrl (GitOps repo — điền khi tạo project)
    const hasRepoUrl = await client.schema.hasColumn(TABLE_PROJECTS, 'repoUrl');
    if (!hasRepoUrl) {
      await client.schema.alterTable(TABLE_PROJECTS, table => {
        table.string('repoUrl');
      });
    }

    // Migration: nodeCount / masterNodeIndex (cấu hình cụm kubeadm)
    const hasNodeCount = await client.schema.hasColumn(TABLE_PROJECTS, 'nodeCount');
    if (!hasNodeCount) {
      await client.schema.alterTable(TABLE_PROJECTS, table => {
        table.integer('nodeCount');
      });
    }
    const hasMasterIdx = await client.schema.hasColumn(TABLE_PROJECTS, 'masterNodeIndex');
    if (!hasMasterIdx) {
      await client.schema.alterTable(TABLE_PROJECTS, table => {
        table.integer('masterNodeIndex');
      });
    }

    // Migration: instanceType + các jenkins param default
    const hasInstanceType = await client.schema.hasColumn(TABLE_PROJECTS, 'instanceType');
    if (!hasInstanceType) {
      await client.schema.alterTable(TABLE_PROJECTS, table => {
        table.string('instanceType');
      });
    }
    for (const col of ['appRepo', 'registryBase', 'imageRepoPrefix', 'vaultEip', 'deployBranch']) {
      const has = await client.schema.hasColumn(TABLE_PROJECTS, col);
      if (!has) {
        await client.schema.alterTable(TABLE_PROJECTS, table => {
          table.string(col);
        });
      }
    }

    const hasJenkins = await client.schema.hasTable(TABLE_JENKINS);
    if (!hasJenkins) {
      await client.schema.createTable(TABLE_JENKINS, table => {
        table.string('name').primary();
        table.string('url').notNullable();
      });
    }

    // iac_artifacts — file IaC sinh ra cho từng project (dạng text, không ghi repo)
    const hasIac = await client.schema.hasTable(TABLE_IAC);
    if (!hasIac) {
      await client.schema.createTable(TABLE_IAC, table => {
        table.increments('id').primary();
        table.string('project_id').notNullable();
        table.string('env'); // dev | stg | prd — file dùng chung để trống
        table.string('path').notNullable(); // VD: terraform/environments/<slug>/dev/main.tf
        table.text('content').notNullable();
        table.timestamp('updated_at').defaultTo(client.fn.now());
        table.index(['project_id']);
      });
    }

    this.#logger.info('projects-backend: database tables ready');
  }

  #toProject(row: any): Project {
    const parse = (v: any, fallback: string[]) => {
      if (!v) return fallback;
      try {
        const arr = JSON.parse(v);
        return Array.isArray(arr) && arr.length > 0 ? arr : fallback;
      } catch {
        return fallback;
      }
    };
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      owner: row.owner,
      kickoffDate: row.kickoffDate ?? '',
      jiraKey: row.jiraKey ?? '',
      jenkinsInstance: row.jenkinsInstance ?? '',
      keyName: row.keyName ?? '',
      status: row.status,
      repoUrl: row.repoUrl ?? '',
      nodeCount: row.nodeCount ?? 3,
      masterNodeIndex: row.masterNodeIndex ?? 0,
      instanceType: row.instanceType ?? 't3.small',
      appRepo: row.appRepo ?? `https://github.com/vinh25042005/${row.slug}.git`,
      registryBase: row.registryBase ?? 'docker.io/vinh2504',
      imageRepoPrefix: row.imageRepoPrefix ?? row.slug,
      vaultEip: row.vaultEip ?? '52.221.18.86',
      deployBranch: row.deployBranch ?? 'week-6-argo-rollouts',
      envs: parse(row.envs, ['dev', 'stg', 'prd']),
      services: parse(row.services, ['backend', 'frontend', 'database']),
    };
  }

  async listProjects(): Promise<Project[]> {
    const rows = await this.#client(TABLE_PROJECTS).select('*');
    return rows.map(r => this.#toProject(r));
  }

  async getProject(id: string): Promise<Project> {
    const row = await this.#client(TABLE_PROJECTS)
      .select('*')
      .where('id', '=', id)
      .first();
    if (!row) throw new NotFoundError(`Project ${id} not found`);
    return this.#toProject(row);
  }

  async createProject(p: Omit<Project, 'id'>): Promise<Project> {
    const id = `PRO-${Date.now()}`;
    await this.#client(TABLE_PROJECTS).insert({
      id,
      name: p.name,
      slug: p.slug,
      owner: p.owner,
      kickoffDate: p.kickoffDate,
      jiraKey: p.jiraKey,
      jenkinsInstance: p.jenkinsInstance,
      keyName: p.keyName,
      status: p.status || 'active',
      repoUrl: p.repoUrl ?? '',
      nodeCount: p.nodeCount ?? 3,
      masterNodeIndex: p.masterNodeIndex ?? 0,
      instanceType: p.instanceType ?? 't3.small',
      appRepo: p.appRepo ?? '',
      registryBase: p.registryBase ?? 'docker.io/vinh2504',
      imageRepoPrefix: p.imageRepoPrefix ?? '',
      vaultEip: p.vaultEip ?? '52.221.18.86',
      deployBranch: p.deployBranch ?? 'main',
      envs: JSON.stringify(p.envs ?? ['dev', 'stg', 'prd']),
      services: JSON.stringify(p.services ?? ['backend', 'frontend', 'database']),
    });
    return this.getProject(id);
  }

  async updateProject(
    id: string,
    p: Partial<Omit<Project, 'id'>>,
  ): Promise<Project> {
    const existing = await this.getProject(id);
    await this.#client(TABLE_PROJECTS)
      .update({
        name: p.name ?? existing.name,
        slug: p.slug ?? existing.slug,
        owner: p.owner ?? existing.owner,
        kickoffDate: p.kickoffDate ?? existing.kickoffDate,
        jiraKey: p.jiraKey ?? existing.jiraKey,
        jenkinsInstance: p.jenkinsInstance ?? existing.jenkinsInstance,
        keyName: p.keyName ?? existing.keyName,
        status: p.status ?? existing.status,
        repoUrl: p.repoUrl ?? existing.repoUrl,
        nodeCount: p.nodeCount ?? existing.nodeCount,
        masterNodeIndex: p.masterNodeIndex ?? existing.masterNodeIndex,
        instanceType: p.instanceType ?? existing.instanceType,
        appRepo: p.appRepo ?? existing.appRepo,
        registryBase: p.registryBase ?? existing.registryBase,
        imageRepoPrefix: p.imageRepoPrefix ?? existing.imageRepoPrefix,
        vaultEip: p.vaultEip ?? existing.vaultEip,
        deployBranch: p.deployBranch ?? existing.deployBranch,
        envs: JSON.stringify(p.envs ?? existing.envs),
        services: JSON.stringify(p.services ?? existing.services),
      })
      .where('id', '=', id);
    return this.getProject(id);
  }

  async deleteProject(id: string): Promise<void> {
    await this.#client(TABLE_PROJECTS).where('id', '=', id).delete();
  }

  async listJenkins(): Promise<JenkinsInstance[]> {
    const rows = await this.#client(TABLE_JENKINS).select('*');
    return rows.map(r => ({ name: r.name, url: r.url }));
  }

  async createJenkins(j: JenkinsInstance): Promise<JenkinsInstance> {
    await this.#client(TABLE_JENKINS).insert({ name: j.name, url: j.url });
    return j;
  }

  // ── IAC artifacts — file IaC sinh cho project (lưu DB, không ghi repo) ──
  async listIac(projectId: string): Promise<any[]> {
    const rows = await this.#client(TABLE_IAC)
      .select('*')
      .where('project_id', '=', projectId)
      .orderBy('path', 'asc');
    return rows.map(r => ({
      id: r.id,
      env: r.env ?? '',
      path: r.path,
      content: r.content,
    }));
  }

  async saveIac(
    projectId: string,
    files: { env?: string; path: string; content: string }[],
  ): Promise<void> {
    // Ghi đè toàn bộ: xoá cũ của project rồi insert mới
    await this.#client(TABLE_IAC).where('project_id', '=', projectId).delete();
    for (const f of files) {
      await this.#client(TABLE_IAC).insert({
        project_id: projectId,
        env: f.env ?? null,
        path: f.path,
        content: f.content,
      });
    }
  }
}

export function makeProjectStore(options: {
  logger: LoggerService;
  database: DatabaseService;
}) {
  return ProjectStoreService.create(options);
}
