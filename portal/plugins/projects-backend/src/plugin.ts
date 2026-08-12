import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { createRouter } from './router';
import { ProjectStoreService } from './services/ProjectStoreService';
import { IacRunner, resolveIacRoot } from './services/IacRunner';
import { VaultService } from './services/VaultService';
import { JenkinsService } from './services/JenkinsService';
import { ProjectConfigService } from './services/ProjectConfigService';

/**
 * projectsBackendPlugin backend plugin
 *
 * @public
 */
export const projectsBackendPlugin = createBackendPlugin({
  pluginId: 'projects-backend',
  register(env) {
    env.registerInit({
      deps: {
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        logger: coreServices.logger,
        database: coreServices.database,
      },
      async init({ httpAuth, httpRouter, logger, database }) {
        const store = await ProjectStoreService.create({ logger, database });
        const iacRoot = resolveIacRoot(logger);
        // Cấu hình per project×env (NETWORK/PUBLISH/MONITOR) lưu trong helm values
        const config = new ProjectConfigService(logger, iacRoot);
        // Vault cho ENV VARS tab — addr/token đọc từ env (có thể cấu hình trong
        // app-config.yaml qua backend.plugins.projects-backend nếu cần)
        const vault = new VaultService(
          logger,
          process.env.VAULT_ADDR || 'https://52.221.18.86:8200',
          process.env.VAULT_TOKEN || '',
        );
        // IacRunner — sau APPLY thành công tự tạo credentials chuẩn vào Vault
        const iac = new IacRunner(logger, iacRoot, async (slug, env, appendLog) => {
          try {
            const res = await vault.ensureStandardSecrets(slug, env);
            const created = res.created.length ? res.created.join(', ') : '—';
            const existing = res.existing.length
              ? ` (đã có: ${res.existing.join(', ')})`
              : '';
            appendLog(
              `✅ Đã tự tạo credentials vào Vault (secret/${slug}/${env}): ${created}${existing}`,
            );
          } catch (e: any) {
            appendLog(`⚠️ Không tự tạo credentials Vault: ${e.message}`);
          }
        });
        // Jenkins — mỗi project → 1 job `<slug>-ci` (tự tạo khi tạo project).
        // Bật bằng cách set JENKINS_USER + JENKINS_TOKEN (giống VAULT_TOKEN).
        const jenkins = new JenkinsService(
          logger,
          process.env.JENKINS_URL || 'http://47.130.241.226:9090',
          process.env.JENKINS_USER || '',
          process.env.JENKINS_TOKEN || '',
          {
            jenkinsfileRepo:
              process.env.JENKINSFILE_REPO ||
              'https://github.com/vinh25042005/deploy-web.git',
            jenkinsfileBranch: process.env.JENKINSFILE_BRANCH || 'week-6-argo-rollouts',
            scmCredential: process.env.JENKINS_SCM_CREDENTIAL || 'github-token',
          },
        );
        httpRouter.use(
          await createRouter({
            httpAuth,
            store,
            iac,
            vault,
            jenkins,
            config,
          }),
        );
      },
    });
  },
});
