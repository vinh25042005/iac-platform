import { LoggerService } from '@backstage/backend-plugin-api';
import { spawn } from 'child_process';
import * as https from 'https';
import * as crypto from 'crypto';

// =============================================================================
// VaultService — quản lý secrets cho ENV VARS tab (Global Application Secrets).
//   - Kết nối Vault qua HTTP API (X-Vault-Token), hỗ trợ KV v2 (ưu tiên) + KV v1.
//   - Path mỗi project×env: secret/<slug>/<env>
//   - Push   (config → Vault): ghi secrets lên Vault.
//   - Sync   (Vault → K8s): đọc từ Vault, tạo/cập nhật K8s Secret trong namespace.
//   - Master Vault: là chính Vault ở đây (addr hiển thị trong UI).
// =============================================================================

export interface VaultSecretList {
  addr: string;
  path: string;
  version: 'v1' | 'v2';
  data: Record<string, string>;
}

export class VaultService {
  readonly #logger: LoggerService;
  readonly #addr: string;
  readonly #token: string;
  readonly #namespace: string;

  constructor(logger: LoggerService, addr: string, token: string) {
    this.#logger = logger;
    this.#addr = (addr || 'https://52.221.18.86:8200').replace(/\/+$/, '');
    this.#token = token || '';
    // Namespace mặc định cho K8s Secret khi sync (có thể truyền đè qua route)
    this.#namespace = '';
  }

  get addr(): string {
    return this.#addr;
  }

  get configured(): boolean {
    return Boolean(this.#token);
  }

  #auth(): Record<string, string> {
    if (!this.#token) {
      throw new Error(
        'VAULT_TOKEN chưa được cấu hình trên backend (env VAULT_TOKEN)',
      );
    }
    return { 'X-Vault-Token': this.#token, 'Content-Type': 'application/json' };
  }

  /**
   * Gọi Vault HTTP API bằng node:https với rejectUnauthorized=false.
   * (Vault nội bộ dùng chứng chỉ TLS tự ký — fetch mặc định sẽ từ chối → "fetch failed")
   */
  #req(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: any; text: string }> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.#addr}/v1/${path}`);
      const payload = body !== undefined ? JSON.stringify(body) : undefined;
      const req = https.request(
        url,
        {
          method,
          headers: {
            ...this.#auth(),
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
          rejectUnauthorized: false,
          timeout: 12000,
        },
        res => {
          let data = '';
          res.on('data', d => (data += d));
          res.on('end', () => {
            let json: any = null;
            try {
              json = JSON.parse(data);
            } catch {
              /* body không phải JSON */
            }
            resolve({ status: res.statusCode ?? 0, json, text: data });
          });
        },
      );
      req.on('error', e =>
        reject(new Error(`Vault không kết nối được (${e.message})`)),
      );
      req.on('timeout', () => req.destroy(new Error('Vault timeout')));
      if (payload) req.write(payload);
      req.end();
    });
  }

  /**
   * Đọc danh sách secrets của 1 path: secret/<slug>/<env>[ /<component>].
   * Thử KV v2 (secret/data/...) trước, fallback KV v1 (secret/...).
   * Chưa có secret → trả data rỗng (không lỗi).
   */
  async list(
    slug: string,
    env: string,
    component = '',
  ): Promise<VaultSecretList> {
    const full = `secret/${slug}/${env}${component ? `/${component}` : ''}`;
    const info = await this.#listPath(full);
    return { addr: this.#addr, path: full, version: info.version, data: info.data };
  }

  /**
   * Đọc 1 path bất kỳ (dạng secret/...) — dùng cho PUBLISH tab (secret/ci/dockerhub).
   * Trả version + data; không tồn tại → data rỗng (không lỗi).
   */
  async readPath(
    fullPath: string,
  ): Promise<{ version: 'v1' | 'v2'; data: Record<string, string>; exists: boolean }> {
    const info = await this.#listPath(fullPath);
    return {
      version: info.version,
      data: info.data,
      exists: Object.keys(info.data).length > 0,
    };
  }

  /** Đọc 1 path bất kỳ (dạng secret/...), KV v2 ưu tiên rồi fallback v1. */
  async #listPath(
    fullPath: string,
  ): Promise<{ version: 'v1' | 'v2'; data: Record<string, string> }> {
    const v2Path = fullPath.replace(/^secret\//, 'secret/data/');
    const v2 = await this.#req('GET', v2Path);
    if (v2.status === 200) {
      return { version: 'v2', data: v2.json?.data?.data ?? {} };
    }
    if (v2.status !== 404) {
      throw new Error(`Vault lỗi (${v2.status}): ${v2.text.slice(0, 300)}`);
    }
    const v1 = await this.#req('GET', fullPath);
    if (v1.status === 200) {
      return { version: 'v1', data: v1.json?.data ?? {} };
    }
    if (v1.status === 404) {
      return { version: 'v2', data: {} };
    }
    throw new Error(`Vault lỗi (${v1.status}): ${v1.text.slice(0, 300)}`);
  }

  /** Ghi 1 path bất kỳ (dạng secret/...), đúng schema v1/v2. */
  async #pushPath(
    fullPath: string,
    version: 'v1' | 'v2',
    data: Record<string, string>,
  ): Promise<void> {
    const body = version === 'v1' ? { ...data } : { data };
    const p = version === 'v1' ? fullPath : fullPath.replace(/^secret\//, 'secret/data/');
    const res = await this.#req('POST', p, body);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Vault push lỗi (${res.status}): ${res.text.slice(0, 300)}`);
    }
  }

  /** Push secrets từ config → Vault (ghi đè toàn bộ secret của path). */
  async push(
    slug: string,
    env: string,
    data: Record<string, string>,
  ): Promise<void> {
    const full = `secret/${slug}/${env}`;
    const info = await this.#listPath(full);
    await this.#pushPath(full, info.version, data);
    this.#logger.info(`vault: push ${slug}/${env} (${Object.keys(data).length} keys)`);
  }

  /**
   * Tự tạo các credential chuẩn (postgres/jwt/grafana) trong Vault nếu chưa có.
   * Được gọi TỰ ĐỘNG sau khi APPLY thành công → mọi pass đều nằm trong Vault.
   * Lưu tại path chính secret/<slug>/<env> để UI ENV VARS hiển thị & đổi được.
   * Idempotent: KHÔNG ghi đè key đã tồn tại (giữ pass người dùng đã set).
   */
  async ensureStandardSecrets(
    slug: string,
    env: string,
  ): Promise<{ created: string[]; existing: string[] }> {
    const gen = (n: number) =>
      crypto.randomBytes(n).toString('base64url').replace(/[-_]/g, '').slice(0, n);
    const full = `secret/${slug}/${env}`;
    const info = await this.#listPath(full);
    const data: Record<string, string> = { ...info.data };

    // Grafana pass capture từ cluster thật (cluster-base-grafana secret) nếu có
    const grafanaPass = (await this.#captureGrafanaPassword()) || gen(16);
    const defaults: Record<string, string> = {
      postgres_password: gen(18),
      jwt_secret: gen(32),
      grafana_admin_user: 'admin',
      grafana_admin_password: grafanaPass,
    };

    const created: string[] = [];
    const existing: string[] = [];
    for (const [k, v] of Object.entries(defaults)) {
      if (!data[k]) {
        data[k] = v;
        created.push(k);
      } else {
        existing.push(k);
      }
    }

    if (created.length > 0) {
      await this.#pushPath(full, info.version, data);
    }
    this.#logger.info(
      `vault: ensureStandardSecrets ${slug}/${env} created=[${created.join(',')}] existing=[${existing.join(',')}]`,
    );
    return { created, existing };
  }

  /** Lấy admin-password Grafana thật từ cluster (nếu có), base64 decode. Trả null nếu cluster chưa lên. */
  async #captureGrafanaPassword(): Promise<string | null> {
    try {
      const out = await this.#runKubectl(
        `kubectl -n kube-system get secret cluster-base-grafana -o jsonpath='{.data.admin-password}' --request-timeout=5s 2>/dev/null`,
        undefined,
        7000, // timeout 7s — kubectl có thể treo khi kubeconfig trỏ tới cluster đã chết
      );
      const b64 = out.trim();
      if (!b64) return null;
      return Buffer.from(b64, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }

  /**
   * Sync Vault → K8s Secret: đọc toàn bộ secret của path, tạo/cập nhật
   * Secret `<slug>-<env>-secrets` trong namespace (kubectl apply -f -).
   * App đọc qua secretKeyRef.
   */
  async syncToK8s(
    slug: string,
    env: string,
    namespace: string,
  ): Promise<{ secretName: string; namespace: string; output: string }> {
    const info = await this.list(slug, env);
    const keys = Object.keys(info.data);
    if (keys.length === 0) {
      throw new Error(
        `Chưa có secret nào trong Vault (${info.path}) — hãy Push trước khi Sync`,
      );
    }
    const secretName = `${slug}-${env}-secrets`;
    const ns = namespace || `${slug}-${env}`;
    const stringData = keys
      .map(k => `  ${k}: ${JSON.stringify(String(info.data[k]))}`)
      .join('\n');
    const yaml = [
      'apiVersion: v1',
      'kind: Secret',
      'metadata:',
      `  name: ${secretName}`,
      `  namespace: ${ns}`,
      'type: Opaque',
      'stringData:',
      stringData,
      '',
    ].join('\n');

    // Tạo namespace nếu chưa có (app chưa deploy qua ArgoCD thì ns chưa tồn tại)
    const nsExists = await this.#runKubectl(
      `kubectl get namespace ${ns} --request-timeout=8s >/dev/null 2>&1 && echo yes || echo no`,
    ).then(o => o.trim() === 'yes').catch(() => false);
    if (!nsExists) {
      await this.#runKubectl(`kubectl create namespace ${ns} --request-timeout=8s`);
      this.#logger.info(`vault: đã tạo namespace ${ns}`);
    }

    const output = await this.#runKubectl(
      `kubectl apply -f - --wait=true --request-timeout=8s`,
      yaml,
    );
    this.#logger.info(
      `vault: sync ${slug}/${env} → K8s Secret ${ns}/${secretName}`,
    );
    return { secretName, namespace: ns, output };
  }

  /** Chạy 1 lệnh kubectl, nhận stdin từ YAML, trả stdout+stderr. */
  #runKubectl(cmd: string, stdin?: string, timeoutMs = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('bash', ['-c', cmd], { env: process.env });
      let out = '';
      let err = '';
      let settled = false;
      // An toàn: kubectl có thể treo vô hạn khi kubeconfig trỏ tới API server chết.
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        reject(
          new Error(
            `kubectl timeout (${timeoutMs}ms): ${(out + err).slice(0, 300) || 'no output'}`,
          ),
        );
      }, timeoutMs);
      child.stdout?.on('data', d => (out += String(d)));
      child.stderr?.on('data', d => (err += String(d)));
      if (stdin != null) child.stdin.write(stdin);
      child.stdin.end();
      child.on('close', code => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const all = out + err;
        if (code === 0) resolve(all);
        else reject(new Error(all.slice(0, 500) || `kubectl exit ${code}`));
      });
    });
  }
}
