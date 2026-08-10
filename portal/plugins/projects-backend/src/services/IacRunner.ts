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
}

const DEFAULT_ENVS = ['dev', 'stg', 'prd'];

export class IacRunner {
  readonly #logger: LoggerService;
  readonly #iacRoot: string;
  #jobs = new Map<string, ApplyJob>();

  constructor(logger: LoggerService, iacRoot: string) {
    this.#logger = logger;
    this.#iacRoot = iacRoot;
  }

  get root(): string {
    return this.#iacRoot;
  }

  /** Sinh scaffold project vào thư mục iac-platform (local, không push GitHub). */
  async generate(
    slug: string,
    envs: string[] = DEFAULT_ENVS,
    keyName = '',
  ): Promise<string[]> {
    const script = path.join(this.#iacRoot, 'scripts', 'new-project.sh');
    if (!fs.existsSync(script)) {
      throw new NotFoundError(`Không tìm thấy ${script}`);
    }
    this.#logger.info(
      `iac: generate project "${slug}" envs=${envs.join(',')} key=${keyName || '(default)'}`,
    );
    const out = await this.#run(
      'bash',
      [script, slug],
      { env: { ...process.env, ENVS: envs.join(' '), KEY_NAME: keyName } },
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

  /** Bắt đầu terraform apply cho 1 env — trả jobId, log chạy nền. */
  startApply(slug: string, env: string): string {
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
    const jobId = `apply-${Date.now()}`;
    const job: ApplyJob = { id: jobId, status: 'running', logs: [] };
    this.#jobs.set(jobId, job);

    this.#logger.info(`iac: apply ${slug}/${env} bắt đầu (job ${jobId})`);
    const child = spawn(
      'bash',
      [
        '-c',
        `cd "${dir}" && terraform init -input=false -no-color && terraform apply -auto-approve -no-color`,
      ],
      { env: process.env },
    );
    child.stdout.on('data', d => {
      job.logs.push(String(d));
    });
    child.stderr.on('data', d => {
      job.logs.push(String(d));
    });
    child.on('close', code => {
      job.exitCode = code ?? undefined;
      job.status = code === 0 ? 'success' : 'error';
      this.#logger.info(
        `iac: apply ${slug}/${env} kết thúc status=${job.status} code=${code}`,
      );
    });
    return jobId;
  }

  getJob(id: string): ApplyJob {
    const job = this.#jobs.get(id);
    if (!job) throw new NotFoundError(`Apply job ${id} not found`);
    return job;
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
