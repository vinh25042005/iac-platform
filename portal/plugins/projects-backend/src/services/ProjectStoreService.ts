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
