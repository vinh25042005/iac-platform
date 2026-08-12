import { LoggerService } from '@backstage/backend-plugin-api';
import * as http from 'http';
import * as https from 'https';

// =============================================================================
// JenkinsService — tạo/quản lý Jenkins job cho MỖI project.
//   - Mỗi project → 1 pipeline job `<slug>-ci` (giống techshop-ci) dùng CHUNG
//     Jenkinsfile (pipeline generic) lấy từ SCM (deploy-web / iac-platform).
//   - Tự tạo job khi tạo project (POST /projects); xoá job khi xoá project.
//   - Gọi Jenkins REST API: /createItem, /job/<name>/doDelete, /api/json, consoleText.
//   - Auth: basic (JENKINS_USER + JENKINS_TOKEN) + CSRF crumb.
//   - Bật/tắt bằng cách set (hoặc bỏ) JENKINS_USER + JENKINS_TOKEN.
// =============================================================================

export interface JenkinsProjectJobOptions {
  appRepo?: string;
  registryBase?: string;
  imageRepoPrefix?: string;
  vaultDbPath?: string;
  vaultEip?: string;
  deployBranch?: string;
  // GitOps repo chứa helm chart + argocd apps (repoUrl điền khi tạo project).
  // Dùng làm GIT_OPS_REPO param cho pipeline (nơi commit manifest ArgoCD).
  gitOpsRepo?: string;
}

export interface JenkinsJobStatus {
  enabled: boolean;
  name: string;
  exists: boolean;
  builds: { number: number; result: string | null; timestamp: number }[];
  lastBuild: { number: number; result: string | null; timestamp: number } | null;
}

interface JenkinsScmConfig {
  jenkinsfileRepo: string;
  jenkinsfileBranch: string;
  scmCredential: string;
}

export class JenkinsService {
  readonly #logger: LoggerService;
  readonly #baseUrl: string;
  readonly #user: string;
  readonly #token: string;
  readonly #scm: JenkinsScmConfig;

  constructor(
    logger: LoggerService,
    baseUrl: string,
    user: string,
    token: string,
    scm: Partial<JenkinsScmConfig> = {},
  ) {
    this.#logger = logger;
    this.#baseUrl = baseUrl.replace(/\/+$/, '');
    this.#user = user;
    this.#token = token;
    this.#scm = {
      jenkinsfileRepo:
        scm.jenkinsfileRepo || 'https://github.com/vinh25042005/deploy-web.git',
      jenkinsfileBranch: scm.jenkinsfileBranch || 'week-6-argo-rollouts',
      scmCredential: scm.scmCredential || 'github-token',
    };
  }

  /** Đã đủ cấu hình (URL + user + token) chưa — thiếu thì không tạo job. */
  get enabled(): boolean {
    return !!(this.#baseUrl && this.#user && this.#token);
  }

  jobName(slug: string): string {
    return `${slug}-ci`;
  }

  /** GET /crumbIssuer/api/json — crumb + tên field cho POST (CSRF của Jenkins). */
  async #crumb(): Promise<{ field: string; crumb: string } | null> {
    try {
      const data = await this.#req('GET', '/crumbIssuer/api/json', null, {}, true);
      return { field: data.crumbRequestField, crumb: data.crumb };
    } catch {
      return null;
    }
  }

  #req(
    method: string,
    path: string,
    body?: string | null,
    headers: Record<string, string> = {},
    json = true,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.#baseUrl}${path}`);
      const lib = url.protocol === 'https:' ? https : http;
      const auth = Buffer.from(`${this.#user}:${this.#token}`).toString('base64');
      const req = lib.request(
        url,
        {
          method,
          headers: { Authorization: `Basic ${auth}`, ...headers },
        },
        res => {
          let data = '';
          res.on('data', d => (data += String(d)));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              if (!json) return resolve(data);
              try {
                resolve(JSON.parse(data));
              } catch {
                resolve(data);
              }
            } else {
              reject(
                new Error(
                  `Jenkins ${method} ${path} → ${res.statusCode}: ${data.slice(0, 300)}`,
                ),
              );
            }
          });
        },
      );
      req.on('error', e =>
        reject(new Error(`Jenkins không kết nối được (${this.#baseUrl}): ${e.message}`)),
      );
      if (body != null) req.write(body);
      req.end();
    });
  }

  async jobExists(name: string): Promise<boolean> {
    try {
      await this.#req('GET', `/job/${encodeURIComponent(name)}/api/json`, null, {}, false);
      return true;
    } catch {
      return false;
    }
  }

  /** Tạo pipeline job `<slug>-ci` cho project (bỏ qua nếu đã tồn tại). */
  async createProjectJob(slug: string, opts: JenkinsProjectJobOptions = {}): Promise<string> {
    if (!this.enabled)
      throw new Error('Jenkins chưa cấu hình — hãy set JENKINS_USER + JENKINS_TOKEN');
    const name = this.jobName(slug);
    if (await this.jobExists(name)) {
      this.#logger.info(`jenkins: job ${name} đã tồn tại — bỏ qua`);
      return name;
    }
    const xml = this.#buildJobXml(slug, opts);
    const crumb = await this.#crumb();
    const headers: Record<string, string> = { 'Content-Type': 'application/xml' };
    if (crumb) headers[crumb.field] = crumb.crumb;
    await this.#req(
      'POST',
      `/createItem?name=${encodeURIComponent(name)}`,
      xml,
      headers,
      false,
    );
    this.#logger.info(`jenkins: đã tạo job ${name} cho project ${slug}`);
    return name;
  }

  /** Xoá pipeline job `<slug>-ci` (bỏ qua nếu không tồn tại). */
  async deleteProjectJob(slug: string): Promise<void> {
    if (!this.enabled) return;
    const name = this.jobName(slug);
    if (!(await this.jobExists(name))) return;
    const crumb = await this.#crumb();
    const headers: Record<string, string> = {};
    if (crumb) headers[crumb.field] = crumb.crumb;
    await this.#req('POST', `/job/${encodeURIComponent(name)}/doDelete`, null, headers, false);
    this.#logger.info(`jenkins: đã xoá job ${name}`);
  }

  /** Trigger build cho job (buildWithParameters). */
  async triggerBuild(jobName: string, params: Record<string, string>): Promise<void> {
    if (!this.enabled)
      throw new Error('Jenkins chưa cấu hình — hãy set JENKINS_USER + JENKINS_TOKEN');
    const qs = new URLSearchParams(params).toString();
    const crumb = await this.#crumb();
    const headers: Record<string, string> = {};
    if (crumb) headers[crumb.field] = crumb.crumb;
    await this.#req(
      'POST',
      `/job/${encodeURIComponent(jobName)}/buildWithParameters?${qs}`,
      null,
      headers,
      false,
    );
    this.#logger.info(`jenkins: đã trigger build ${jobName} params=${qs}`);
  }

  /** Trạng thái job: có tồn tại không + danh sách build gần đây. */
  async getJobStatus(slug: string): Promise<JenkinsJobStatus> {
    const name = this.jobName(slug);
    const base: JenkinsJobStatus = {
      enabled: this.enabled,
      name,
      exists: false,
      builds: [],
      lastBuild: null,
    };
    if (!this.enabled) return base;
    try {
      const data = await this.#req(
        'GET',
        `/job/${encodeURIComponent(name)}/api/json?tree=builds[number,result,timestamp]{0,15},lastBuild[number,result,timestamp],color`,
        null,
        {},
        true,
      );
      const builds = (data.builds || []).map((b: any) => ({
        number: b.number,
        result: b.result,
        timestamp: b.timestamp,
      }));
      return {
        ...base,
        exists: true,
        builds,
        lastBuild: data.lastBuild
          ? {
              number: data.lastBuild.number,
              result: data.lastBuild.result,
              timestamp: data.lastBuild.timestamp,
            }
          : null,
      };
    } catch {
      return base;
    }
  }

  /** Log console của 1 build. */
  async getBuildLog(slug: string, number: number): Promise<string> {
    const name = this.jobName(slug);
    return this.#req(
      'GET',
      `/job/${encodeURIComponent(name)}/${number}/consoleText`,
      null,
      {},
      false,
    );
  }

  #esc(s: string): string {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Sinh config.xml pipeline job giống techshop-ci, param theo project. */
  #buildJobXml(slug: string, opts: JenkinsProjectJobOptions): string {
    const envs = ['dev', 'stg', 'prd'].map(e => `<string>${e}</string>`).join('');
    const modes = ['full', 'ci', 'release'].map(m => `<string>${m}</string>`).join('');
    const str = (name: string, dv: string) =>
      `<hudson.model.StringParameterDefinition><name>${name}</name><defaultValue>${this.#esc(dv)}</defaultValue><trim>false</trim></hudson.model.StringParameterDefinition>`;
    const bool = (name: string) =>
      `<hudson.model.BooleanParameterDefinition><name>${name}</name><defaultValue>false</defaultValue></hudson.model.BooleanParameterDefinition>`;

    const vaultDbPath = opts.vaultDbPath || `secret/${slug}/dev`;
    return `<?xml version='1.1' encoding='UTF-8'?>
<flow-definition plugin="workflow-job">
  <description>CI/CD cho project ${this.#esc(slug)} — pipeline generic (Jenkinsfile)</description>
  <keepDependencies>false</keepDependencies>
  <properties>
    <hudson.model.ParametersDefinitionProperty>
      <parameterDefinitions>
        <hudson.model.ChoiceParameterDefinition><name>ENV</name><choices>${envs}</choices></hudson.model.ChoiceParameterDefinition>
        <hudson.model.ChoiceParameterDefinition><name>MODE</name><choices>${modes}</choices></hudson.model.ChoiceParameterDefinition>
        ${bool('SKIP_BUILD')}
        ${bool('SKIP_BACKEND')}
        ${bool('SKIP_FRONTEND')}
        ${bool('BUILD_FULL')}
        ${bool('ROTATE_DB_PASSWORD')}
        ${str('PROJECT_NAME', slug)}
        ${str('APP_REPO', opts.appRepo || `https://github.com/vinh25042005/${slug}.git`)}
        ${str('REGISTRY_BASE', opts.registryBase || 'docker.io/vinh2504')}
        ${str('IMAGE_REPO_PREFIX', opts.imageRepoPrefix || slug)}
        ${str('VAULT_DB_PATH', vaultDbPath)}
        ${str('VAULT_EIP', opts.vaultEip || '52.221.18.86')}
        ${str('DEPLOY_BRANCH', opts.deployBranch || 'week-6-argo-rollouts')}
        ${str('GIT_OPS_REPO', opts.gitOpsRepo || 'https://github.com/vinh25042005/iac-platform.git')}
        ${str('IMAGE_TAG_OVERRIDE', '')}
        ${str('IMAGE_TAG_OVERRIDE_BACKEND', '')}
        ${str('IMAGE_TAG_OVERRIDE_FRONTEND', '')}
        ${str('ENABLED_STAGES', '["fetch-secrets","cluster-secrets","sonar","build","scan","sign","verify","cleanup","gitops"]')}
      </parameterDefinitions>
    </hudson.model.ParametersDefinitionProperty>
  </properties>
  <definition class="org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition" plugin="workflow-cps">
    <scm class="hudson.plugins.git.GitSCM" plugin="git">
      <configVersion>2</configVersion>
      <userRemoteConfigs>
        <hudson.plugins.git.UserRemoteConfig>
          <url>${this.#esc(this.#scm.jenkinsfileRepo)}</url>
          <credentialsId>${this.#esc(this.#scm.scmCredential)}</credentialsId>
        </hudson.plugins.git.UserRemoteConfig>
      </userRemoteConfigs>
      <branches>
        <hudson.plugins.git.BranchSpec>
          <name>*/${this.#esc(this.#scm.jenkinsfileBranch)}</name>
        </hudson.plugins.git.BranchSpec>
      </branches>
      <doGenerateSubmoduleConfigurations>false</doGenerateSubmoduleConfigurations>
      <submoduleCfg class="empty-list"/>
      <extensions/>
    </scm>
    <scriptPath>Jenkinsfile</scriptPath>
    <lightweight>true</lightweight>
  </definition>
  <triggers/>
  <disabled>false</disabled>
</flow-definition>
`;
  }
}
