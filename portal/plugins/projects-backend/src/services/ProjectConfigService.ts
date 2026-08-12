import { LoggerService } from '@backstage/backend-plugin-api';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import yaml from 'js-yaml';

// =============================================================================
// ProjectConfigService — đọc/ghi cấu hình per project×env cho các tab
// NETWORK / PUBLISH / MONITOR (lưu trong helm/_base/values/<slug>/).
//   - Đọc: values.yaml (mặc định project) + values-<env>.yaml (override env).
//   - Ghi: chỉ ghi vào values-<env>.yaml (giữ nguyên file base + comments).
//   - NLB: query AWS describe-load-balancers để hiển thị DNS name (best-effort).
// =============================================================================

export interface NetworkConfig {
  ingressClass: string;
  host: string;
  tlsEnabled: boolean;
  tlsSecret: string;
  clusterIssuer: string;
}

export interface PublishConfig {
  imageRepo: string;
  imageTag: string;
}

export interface MonitorConfig {
  grafanaHost: string;
  prometheusAddress: string;
  ruleGroupName: string;
  hpaEnabled: boolean;
  hpaMin: number;
  hpaMax: number;
  hpaTargetCPU: number;
}

export interface EnvConfig {
  env: string;
  paths: { valuesFile: string; envFile: string };
  network: NetworkConfig;
  publish: PublishConfig;
  monitor: MonitorConfig;
  nlb: { dnsName: string } | null;
}

/** Merge đệ quy 2 object thuần (base ← override). Mảng thay thế hẳn. */
function deepMerge(base: any, over: any): any {
  const out = Array.isArray(over)
    ? [...over]
    : { ...(base ?? {}) };
  for (const [k, v] of Object.entries(over ?? {})) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      base &&
      typeof base[k] === 'object' &&
      !Array.isArray(base[k])
    ) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export class ProjectConfigService {
  readonly #logger: LoggerService;
  readonly #iacRoot: string;

  constructor(logger: LoggerService, iacRoot: string) {
    this.#logger = logger;
    this.#iacRoot = iacRoot;
  }

  #dir(slug: string): string {
    return path.join(this.#iacRoot, 'helm', '_base', 'values', slug);
  }

  #envFile(slug: string, env: string): string {
    return path.join(this.#dir(slug), `values-${env}.yaml`);
  }

  #readYaml(file: string): any | null {
    try {
      if (!fs.existsSync(file)) return null;
      return yaml.load(fs.readFileSync(file, 'utf8')) ?? {};
    } catch (e: any) {
      this.#logger.warn(`config: đọc YAML lỗi ${file}: ${e.message}`);
      return {};
    }
  }

  /** Đọc cấu hình 1 env: merge values.yaml (base) + values-<env>.yaml (override). */
  async getConfig(slug: string, env: string): Promise<EnvConfig> {
    const dir = this.#dir(slug);
    const base = this.#readYaml(path.join(dir, 'values.yaml')) ?? {};
    const envVals = this.#readYaml(this.#envFile(slug, env)) ?? {};
    const v = deepMerge(base, envVals);

    const cfg: EnvConfig = {
      env,
      paths: {
        valuesFile: `helm/_base/values/${slug}/values.yaml`,
        envFile: `helm/_base/values/${slug}/values-${env}.yaml`,
      },
      network: {
        ingressClass: v?.ingress?.className || 'nginx',
        host: v?.ingress?.host || `${slug}.local`,
        tlsEnabled: v?.ingress?.tls?.enabled ?? true,
        tlsSecret: v?.ingress?.tlsSecret || `${slug}-tls`,
        clusterIssuer: v?.ingress?.clusterIssuer || 'selfsigned-issuer',
      },
      publish: {
        imageRepo: v?.images?.repo || 'docker.io/youruser',
        imageTag: v?.images?.tag || 'latest',
      },
      monitor: {
        grafanaHost: v?.monitoring?.grafanaHost || `grafana.${slug}.local`,
        prometheusAddress: v?.monitoring?.prometheusAddress || '',
        ruleGroupName: v?.monitoring?.ruleGroupName || slug,
        hpaEnabled: v?.hpa?.enabled ?? true,
        hpaMin: v?.hpa?.minReplicas ?? 2,
        hpaMax: v?.hpa?.maxReplicas ?? 5,
        hpaTargetCPU: v?.hpa?.targetCPU ?? 50,
      },
      nlb: await this.#nlbDns(slug, env),
    };
    return cfg;
  }

  /**
   * Ghi patch vào values-<env>.yaml (deep-merge với nội dung hiện có).
   * patch dùng đúng shape của helm values (ingress/images/monitoring/hpa...).
   */
  updateConfig(slug: string, env: string, patch: Record<string, unknown>): string {
    const file = this.#envFile(slug, env);
    const current = this.#readYaml(file) ?? {};
    const merged = deepMerge(current, patch);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, yaml.dump(merged, { indent: 2, lineWidth: 120 }));
    this.#logger.info(`config: đã ghi ${file}`);
    return file;
  }

  /** NLB DNS name (best-effort — không có cluster thì null). */
  async #nlbDns(slug: string, env: string): Promise<{ dnsName: string } | null> {
    const name = `${slug}-${env}-nlb`;
    return new Promise(resolve => {
      exec(
        `aws elbv2 describe-load-balancers --names ${name} --query 'LoadBalancers[0].DNSName' --output text`,
        { timeout: 15000, maxBuffer: 1024 * 1024 },
        (err, stdout) => {
          if (err || !stdout) return resolve(null);
          const dns = stdout.trim();
          if (!dns || dns.includes('None')) return resolve(null);
          resolve({ dnsName: dns });
        },
      );
    });
  }
}
