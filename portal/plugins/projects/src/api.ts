import { fetchApiRef, useApi } from '@backstage/frontend-plugin-api';
import { useMemo } from 'react';

export interface Project {
  id: string;
  name: string;
  slug: string;
  owner: string;
  kickoffDate: string;
  jiraKey: string;
  jenkinsInstance: string;
  keyName: string;
  status: string;
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
        if (!r.ok) throw new Error(`createProject failed: ${r.status}`);
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
    };
  }, [fetch, base]);
}
