import { LoggerService } from '@backstage/backend-plugin-api';
import { spawn, execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { NotFoundError } from '@backstage/errors';

// =============================================================================
// IacRunner — sinh + áp dụng hạ tầng IaC cho 1 project.
//   - generate: chạy scripts/new-project.sh (LOCAL, KHÔNG push GitHub)
//     → sinh terraform/environments/<slug>/{dev,stg,prd}/, helm values, argocd apps
//   - apply: chạy `terraform init && terraform apply` trong thư mục env của project
//     → job chạy nền, frontend poll log theo jobId
// =============================================================================

export interface ApplyJob {
  id: string;
  status: 'running' | 'success' | 'error';
  logs: string[];
  exitCode?: number;
  // Metadata để frontend biết job này thuộc project/env nào (mở lại log)
  project: string;
  env: string;
  mode: 'apply' | 'destroy' | 'init' | 'plan';
}

const DEFAULT_ENVS = ['dev', 'stg', 'prd'];

/** Callback chạy sau khi APPLY thành công (tự tạo credentials Vault). */
export type OnApplySuccess = (
  slug: string,
  env: string,
  appendLog: (line: string) => void,
) => Promise<void>;

export class IacRunner {
  readonly #logger: LoggerService;
  readonly #iacRoot: string;
  readonly #onApplySuccess?: OnApplySuccess;
  #jobs = new Map<string, ApplyJob>();
  // Lock tầng ứng dụng: key = `${project}/${env}`, value = jobId đang giữ lock.
  // Chặn việc bấm Apply/Destroy 2 lần (hoặc Apply + Destroy cùng lúc) trên cùng 1 env.
  #locks = new Map<string, string>();

  constructor(logger: LoggerService, iacRoot: string, onApplySuccess?: OnApplySuccess) {
    this.#logger = logger;
    this.#iacRoot = iacRoot;
    this.#onApplySuccess = onApplySuccess;
  }

  /** Chiếm lock cho 1 project/env — ném lỗi nếu đang có job khác giữ. */
  #acquireLock(key: string, jobId: string): void {
    const holder = this.#locks.get(key);
    if (holder) {
      throw new Error(
        `Đang có job "${holder}" chạy trên ${key} — hãy chờ job đó xong rồi mới thao tác tiếp.`,
      );
    }
    this.#locks.set(key, jobId);
  }

  /** Nhả lock khi job kết thúc (chỉ nhả nếu vẫn do job này giữ). */
  #releaseLock(key: string, jobId: string): void {
    if (this.#locks.get(key) === jobId) {
      this.#locks.delete(key);
    }
  }

  get root(): string {
    return this.#iacRoot;
  }

  /** Sinh scaffold project vào thư mục iac-platform (local, không push GitHub). */
  async generate(
    slug: string,
    envs: string[] = DEFAULT_ENVS,
    keyName = '',
    repoUrl = 'https://github.com/vinh25042005/iac-platform.git',
    nodeCount = 3,
    masterNodeIndex = 0,
    services: string[] = ['backend', 'frontend', 'database'],
    instanceType = 't3.small',
    registryBase = 'docker.io/vinh2504',
    imageRepoPrefix = '',
  ): Promise<string[]> {
    const script = path.join(this.#iacRoot, 'scripts', 'new-project.sh');
    if (!fs.existsSync(script)) {
      throw new NotFoundError(`Không tìm thấy ${script}`);
    }
    // Rancher standalone: bật khi service "rancher" được chọn lúc tạo project
    const enableRancher = services.includes('rancher');
    this.#logger.info(
      `iac: generate project "${slug}" envs=${envs.join(',')} key=${keyName || '(default)'} repo=${repoUrl} nodes=${nodeCount} masterIdx=${masterNodeIndex} services=${services.join(',')} rancher=${enableRancher} registry=${registryBase} prefix=${imageRepoPrefix}`,
    );
    const out = await this.#run(
      'bash',
      [script, slug],
      {
        env: {
          ...process.env,
          ENVS: envs.join(' '),
          KEY_NAME: keyName,
          GIT_ORIGIN: repoUrl,
          NODE_COUNT: String(nodeCount),
          MASTER_NODE_INDEX: String(masterNodeIndex),
          ENABLE_RANCHER: enableRancher ? 'true' : 'false',
          INSTANCE_TYPE: instanceType,
          REGISTRY_BASE: registryBase,
          IMAGE_REPO_PREFIX: imageRepoPrefix,
        },
      },
      60_000,
    );
    this.#logger.info(`iac: generate ${slug} OK\n${out}`);

    // Liệt kê các file terraform đã sinh
    const files: string[] = [];
    for (const env of envs) {
      const dir = path.join(
        this.#iacRoot,
        'terraform',
        'environments',
        slug,
        env,
      );
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) {
          files.push(`terraform/environments/${slug}/${env}/${f}`);
        }
      }
    }
    return files;
  }

  /**
   * Bắt đầu 1 job terraform (init/plan/apply/destroy) cho 1 env — trả jobId,
   * log chạy nền. Mọi mode đều chạy `terraform init -reconfigure` trước (nạp
   * lại backend config để nhất quán); plan/apply/destroy chỉ khác lệnh cuối.
   */
  startJob(
    slug: string,
    env: string,
    mode: 'apply' | 'destroy' | 'init' | 'plan',
  ): string {
    const dir = path.join(
      this.#iacRoot,
      'terraform',
      'environments',
      slug,
      env,
    );
    if (!fs.existsSync(path.join(dir, 'main.tf'))) {
      throw new NotFoundError(
        `Chưa có main.tf tại ${dir} — hãy tạo project / bấm Generate IaC trước`,
      );
    }
    const jobId = `${mode}-${Date.now()}`;
    // Chống chạy song song: chiếm lock trước khi tạo job
    this.#acquireLock(`${slug}/${env}`, jobId);
    const job: ApplyJob = {
      id: jobId,
      status: 'running',
      logs: [],
      project: slug,
      env,
      mode,
    };
    this.#jobs.set(jobId, job);

    // -reconfigure: nạp lại backend config (cần sau khi thêm dynamodb_table)
    const init = 'terraform init -input=false -reconfigure -no-color';
    const cmd: Record<typeof mode, string> = {
      init,
      plan: `${init} && terraform plan -no-color`,
      apply: `${init} && terraform apply -auto-approve -no-color`,
      destroy: `${init} && terraform destroy -auto-approve -no-color`,
    };

    this.#logger.info(`iac: ${mode} ${slug}/${env} bắt đầu (job ${jobId})`);
    const child = spawn('bash', ['-c', `cd "${dir}" && ${cmd[mode]}`], {
      env: process.env,
    });
    this.#wireJob(child, job, `${mode} ${slug}/${env}`, `${slug}/${env}`, jobId);
    return jobId;
  }

  startApply(slug: string, env: string): string {
    return this.startJob(slug, env, 'apply');
  }

  startDestroy(slug: string, env: string): string {
    return this.startJob(slug, env, 'destroy');
  }

  startInit(slug: string, env: string): string {
    return this.startJob(slug, env, 'init');
  }

  startPlan(slug: string, env: string): string {
    return this.startJob(slug, env, 'plan');
  }

  /** Gắn pipe stdout/stderr + đóng job khi child process kết thúc. */
  #wireJob(
    child: import('child_process').ChildProcess,
    job: ApplyJob,
    label: string,
    lockKey?: string,
    jobId?: string,
  ) {
    child.stdout?.on('data', d => {
      job.logs.push(String(d));
    });
    child.stderr?.on('data', d => {
      job.logs.push(String(d));
    });
    child.on('close', code => {
      job.exitCode = code ?? undefined;
      job.status = code === 0 ? 'success' : 'error';
      // Nhả lock tầng ứng dụng khi job kết thúc (mọi code exit)
      if (lockKey && jobId) this.#releaseLock(lockKey, jobId);
      this.#logger.info(`iac: ${label} kết thúc status=${job.status} code=${code}`);
      // Sau APPLY thành công → tự tạo credentials chuẩn trong Vault (fire-and-forget)
      if (code === 0 && job.mode === 'apply' && this.#onApplySuccess) {
        const appendLog = (line: string) => job.logs.push(line);
        this.#onApplySuccess(job.project, job.env, appendLog).catch(err =>
          appendLog(`⚠️ Không tự tạo secret Vault: ${err.message}`),
        );
      }
    });
  }

  getJob(id: string): ApplyJob {
    const job = this.#jobs.get(id);
    if (!job) throw new NotFoundError(`Apply job ${id} not found`);
    return job;
  }

  /**
   * Liệt kê các job còn trong bộ nhớ (running trước, rồi đến mới nhất).
   * Frontend dùng để hiện badge + nút mở lại log khi lỡ đóng dialog.
   */
  listJobs(): ApplyJob[] {
    return Array.from(this.#jobs.values()).sort((a, b) => {
      if (a.status === 'running' && b.status !== 'running') return -1;
      if (b.status === 'running' && a.status !== 'running') return 1;
      return 0;
    });
  }

  /**
   * Xoá toàn bộ file IaC sinh ra cho 1 project (gọi khi xoá project trên UI).
   * Xoá: terraform/environments/<slug>/, helm/_base/values/<slug>/,
   *      argocd/apps/<slug>-*.yaml, ansible/inventories/<slug>-*.ini,
   *      và gỡ khỏi projects.txt registry.
   * Slug đã được sanitize (a-z0-9-) ở router nên an toàn cho path.
   */
  removeProjectFiles(slug: string): string[] {
    const removed: string[] = [];

    // ── Terraform environments ──
    const tfDir = path.join(this.#iacRoot, 'terraform', 'environments', slug);
    if (fs.existsSync(tfDir)) {
      fs.rmSync(tfDir, { recursive: true, force: true });
      removed.push(`terraform/environments/${slug}/`);
      this.#logger.info(`iac: removed ${tfDir}`);
    }

    // ── Helm values ──
    const helmDir = path.join(this.#iacRoot, 'helm', '_base', 'values', slug);
    if (fs.existsSync(helmDir)) {
      fs.rmSync(helmDir, { recursive: true, force: true });
      removed.push(`helm/_base/values/${slug}/`);
      this.#logger.info(`iac: removed ${helmDir}`);
    }

    // ── ArgoCD apps: <slug>-<env>.yaml ──
    const appsDir = path.join(this.#iacRoot, 'argocd', 'apps');
    if (fs.existsSync(appsDir)) {
      for (const f of fs.readdirSync(appsDir)) {
        if (f.startsWith(`${slug}-`) && f.endsWith('.yaml')) {
          fs.rmSync(path.join(appsDir, f), { force: true });
          removed.push(`argocd/apps/${f}`);
          this.#logger.info(`iac: removed argocd/apps/${f}`);
        }
      }
    }

    // ── Ansible inventories: <slug>-<env>.ini ──
    const invDir = path.join(this.#iacRoot, 'ansible', 'inventories');
    if (fs.existsSync(invDir)) {
      for (const f of fs.readdirSync(invDir)) {
        if (f.startsWith(`${slug}-`) && f.endsWith('.ini')) {
          fs.rmSync(path.join(invDir, f), { force: true });
          removed.push(`ansible/inventories/${f}`);
          this.#logger.info(`iac: removed ansible/inventories/${f}`);
        }
      }
    }

    // ── Registry projects.txt: gỡ dòng slug ──
    const registry = path.join(this.#iacRoot, 'projects.txt');
    if (fs.existsSync(registry)) {
      const lines = fs
        .readFileSync(registry, 'utf8')
        .split('\n')
        .filter(l => l.trim() !== slug);
      fs.writeFileSync(registry, lines.join('\n'));
      this.#logger.info(`iac: gỡ '${slug}' khỏi projects.txt`);
    }

    return removed;
  }

  #run(
    cmd: string,
    args: string[],
    opts: { env: NodeJS.ProcessEnv; timeout?: number },
    defaultTimeoutMs: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        cmd,
        args,
        { ...opts, timeout: opts.timeout ?? defaultTimeoutMs, maxBuffer: 20 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve(stdout);
        },
      );
    });
  }
}

/** Tìm thư mục root của iac-platform (nơi chứa scripts/new-project.sh). */
export function resolveIacRoot(logger: LoggerService): string {
  const envRoot = process.env.IAC_PLATFORM_ROOT;
  if (envRoot) return envRoot;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'scripts', 'new-project.sh'))) {
      logger.info(`iac: root = ${dir}`);
      return dir;
    }
    dir = path.dirname(dir);
  }
  const fallback = path.resolve(process.cwd(), '..');
  logger.warn(`iac: không tự tìm thấy root, dùng fallback ${fallback}`);
  return fallback;
}
