import { fetchApiRef, useApi } from '@backstage/frontend-plugin-api';
import { useMemo } from 'react';

export interface Project {
  id: string;
  name: string;
  slug: string;
  owner: string;
  jenkinsInstance: string;
  keyName: string;
  status: string;
  // GitOps repo chứa helm chart + argocd apps (điền khi tạo project)
  repoUrl: string;
  // Cụm kubeadm: tổng số node + node nào làm master (tùy chọn khi tạo project)
  nodeCount: number;
  masterNodeIndex: number;
  // Loại máy EC2 (t3.small / t3.medium / t3.large...) — chọn khi tạo project
  instanceType: string;
  // ── Jenkins job params (default hiển thị sẵn trên Jenkins UI) ──
  appRepo: string;
  registryBase: string;
  imageRepoPrefix: string;
  vaultEip: string;
  deployBranch: string;
  // Môi trường + service được chọn khi tạo project (wizard Add Project)
  envs: string[];
  services: string[];
}

export interface JenkinsInstance {
  name: string;
  url: string;
}

// Wrapper nhỏ quanh plugin://projects API (backend plugin proxy qua fetchApiRef)
// LƯU Ý: plugin://<id> resolve theo pluginId của BACKEND plugin (projects-backend),
//   KHÔNG phải tên frontend plugin. Sai id → mọi request trượt (404) → UI không chạy.
export function useProjectsApi() {
  const { fetch } = useApi(fetchApiRef);

  const base = 'plugin://projects-backend';

  // IMPORTANT: dùng useMemo để object api ỔN ĐỊNH theo `fetch`.
  //   Nếu không, mỗi render tạo object mới → useEffect([api]) chạy lại → setState
  //   → re-render → vòng lặp vô hạn (trang nhấp nháy, không hiện project).
  return useMemo(() => {
    return {
      async listProjects(): Promise<Project[]> {
        const r = await fetch(`${base}/projects`);
        if (!r.ok) throw new Error(`listProjects failed: ${r.status}`);
        return r.json();
      },

      async createProject(p: Omit<Project, 'id'>): Promise<Project> {
        const r = await fetch(`${base}/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p),
        });
        if (!r.ok) throw new Error(await errorMessage(r, 'createProject'));
        return r.json();
      },

      async deleteProject(id: string): Promise<void> {
        const r = await fetch(`${base}/projects/${id}`, { method: 'DELETE' });
        if (!r.ok) throw new Error(`deleteProject failed: ${r.status}`);
      },

      async listJenkins(): Promise<JenkinsInstance[]> {
        const r = await fetch(`${base}/jenkins`);
        if (!r.ok) throw new Error(`listJenkins failed: ${r.status}`);
        return r.json();
      },

      async createJenkins(j: JenkinsInstance): Promise<JenkinsInstance> {
        const r = await fetch(`${base}/jenkins`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(j),
        });
        if (!r.ok) throw new Error(`createJenkins failed: ${r.status}`);
        return r.json();
      },

      // ── IaC: sinh file + apply terraform ──
      async generateProject(id: string): Promise<string[]> {
        const r = await fetch(`${base}/projects/${id}/generate`, {
          method: 'POST',
        });
        if (!r.ok) throw new Error(`generateProject failed: ${r.status}`);
        const data = await r.json();
        return data.files ?? [];
      },

      async applyProject(id: string, env: string): Promise<string> {
        const r = await fetch(`${base}/projects/${id}/apply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ env }),
        });
        if (!r.ok) throw new Error(`applyProject failed: ${r.status}`);
        const data = await r.json();
        return data.jobId;
      },

      async destroyProject(id: string, env: string): Promise<string> {
        const r = await fetch(`${base}/projects/${id}/destroy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ env }),
        });
        if (!r.ok) throw new Error(`destroyProject failed: ${r.status}`);
        const data = await r.json();
        return data.jobId;
      },

      // ── Terraform orchestrator: INIT / PLAN (job nền, poll log) ──
      async initProject(id: string, env: string): Promise<string> {
        const r = await fetch(`${base}/projects/${id}/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ env }),
        });
        if (!r.ok) throw new Error(`initProject failed: ${r.status}`);
        const data = await r.json();
        return data.jobId;
      },

      async planProject(id: string, env: string): Promise<string> {
        const r = await fetch(`${base}/projects/${id}/plan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ env }),
        });
        if (!r.ok) throw new Error(`planProject failed: ${r.status}`);
        const data = await r.json();
        return data.jobId;
      },

      async getApplyJob(jobId: string): Promise<{
        id: string;
        status: string;
        logs: string[];
        exitCode?: number;
      }> {
        const r = await fetch(`${base}/apply/${jobId}`);
        if (!r.ok) throw new Error(`getApplyJob failed: ${r.status}`);
        return r.json();
      },

      // Danh sách job init/plan/apply/destroy đang/đã chạy (mở lại log)
      async listApplyJobs(): Promise<
        {
          id: string;
          status: string;
          logs: string[];
          exitCode?: number;
          project: string;
          env: string;
          mode: 'apply' | 'destroy' | 'init' | 'plan';
        }[]
      > {
        const r = await fetch(`${base}/apply/jobs`);
        if (!r.ok) throw new Error(`listApplyJobs failed: ${r.status}`);
        return r.json();
      },

      // ── ENV VARS: Vault secrets (Global Application Secrets) ──
      async listVaultSecrets(id: string, env: string): Promise<{
        addr: string;
        path: string;
        version: string;
        data: Record<string, string>;
      }> {
        const r = await fetch(`${base}/projects/${id}/vault/secrets?env=${env}`);
        if (!r.ok) throw new Error(await errorMessage(r, 'listVaultSecrets'));
        return r.json();
      },

      async pushVaultSecrets(
        id: string,
        env: string,
        data: Record<string, string>,
      ): Promise<void> {
        const r = await fetch(`${base}/projects/${id}/vault/secrets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ env, data }),
        });
        if (!r.ok) throw new Error(await errorMessage(r, 'pushVaultSecrets'));
      },

      async syncVaultToK8s(
        id: string,
        env: string,
        namespace: string,
      ): Promise<{ secretName: string; namespace: string; output: string }> {
        const r = await fetch(`${base}/projects/${id}/vault/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ env, namespace }),
        });
        if (!r.ok) throw new Error(await errorMessage(r, 'syncVaultToK8s'));
        return r.json();
      },

      // ── Jenkins job theo project (tự tạo khi tạo project) ──
      async getJenkinsJob(
        id: string,
      ): Promise<{
        enabled: boolean;
        name: string;
        exists: boolean;
        builds: { number: number; result: string | null; timestamp: number }[];
        lastBuild: { number: number; result: string | null; timestamp: number } | null;
      }> {
        const r = await fetch(`${base}/projects/${id}/jenkins/job`);
        if (!r.ok) throw new Error(await errorMessage(r, 'getJenkinsJob'));
        return r.json();
      },

      async createJenkinsJob(
        id: string,
      ): Promise<{
        ok: boolean;
        name: string;
        exists: boolean;
        builds: { number: number; result: string | null }[];
      }> {
        const r = await fetch(`${base}/projects/${id}/jenkins/job`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!r.ok) throw new Error(await errorMessage(r, 'createJenkinsJob'));
        return r.json();
      },

      async deleteJenkinsJob(id: string): Promise<{ ok: boolean }> {
        const r = await fetch(`${base}/projects/${id}/jenkins/job`, {
          method: 'DELETE',
        });
        if (!r.ok) throw new Error(await errorMessage(r, 'deleteJenkinsJob'));
        return r.json();
      },

      async triggerJenkinsBuild(
        id: string,
        env: string,
        mode: string,
      ): Promise<{ ok: boolean; name: string }> {
        const r = await fetch(`${base}/projects/${id}/jenkins/build`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ env, mode }),
        });
        if (!r.ok) throw new Error(await errorMessage(r, 'triggerJenkinsBuild'));
        return r.json();
      },

      async getJenkinsBuildLog(id: string, number: number): Promise<string> {
        const r = await fetch(
          `${base}/projects/${id}/jenkins/builds/${number}/log`,
        );
        if (!r.ok) throw new Error(await errorMessage(r, 'getJenkinsBuildLog'));
        const data = await r.json();
        return data.log;
      },

      // ── Cấu hình per project×env: NETWORK / PUBLISH / MONITOR (helm values) ──
      async getEnvConfig(
        id: string,
        env: string,
      ): Promise<{
        env: string;
        paths: { valuesFile: string; envFile: string };
        network: {
          ingressClass: string;
          host: string;
          tlsEnabled: boolean;
          tlsSecret: string;
          clusterIssuer: string;
        };
        publish: { imageRepo: string; imageTag: string };
        monitor: {
          grafanaHost: string;
          prometheusAddress: string;
          ruleGroupName: string;
          hpaEnabled: boolean;
          hpaMin: number;
          hpaMax: number;
          hpaTargetCPU: number;
        };
        nlb: { dnsName: string } | null;
      }> {
        const r = await fetch(`${base}/projects/${id}/config?env=${env}`);
        if (!r.ok) throw new Error(await errorMessage(r, 'getEnvConfig'));
        return r.json();
      },

      async updateEnvConfig(
        id: string,
        env: string,
        patch: Record<string, unknown>,
      ): Promise<{ ok: boolean; file: string }> {
        const r = await fetch(`${base}/projects/${id}/config`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ env, patch }),
        });
        if (!r.ok) throw new Error(await errorMessage(r, 'updateEnvConfig'));
        return r.json();
      },

      // PUBLISH: trạng thái DockerHub credential trong Vault
      async getDockerHubStatus(
        id: string,
      ): Promise<{
        path: string;
        version: string;
        exists: boolean;
        data: Record<string, string>;
      }> {
        const r = await fetch(`${base}/projects/${id}/publish/dockerhub`);
        if (!r.ok) throw new Error(await errorMessage(r, 'getDockerHubStatus'));
        return r.json();
      },
    };
  }, [fetch, base]);
}

// Đọc message lỗi từ response backend (Backstage error body: { error: { message } })
async function errorMessage(r: Response, fallback: string): Promise<string> {
  let msg = `${fallback} failed: ${r.status}`;
  try {
    const data = await r.json();
    if (data?.error?.message) msg = data.error.message;
  } catch {
    /* không đọc được body — giữ message mặc định */
  }
  return msg;
}
