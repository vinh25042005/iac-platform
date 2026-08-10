import { fetchApiRef, useApi } from '@backstage/frontend-plugin-api';

export interface Project {
  id: string;
  name: string;
  slug: string;
  owner: string;
  kickoffDate: string;
  jiraKey: string;
  jenkinsInstance: string;
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

  async function listProjects(): Promise<Project[]> {
    const r = await fetch(`${base}/projects`);
    if (!r.ok) throw new Error(`listProjects failed: ${r.status}`);
    return r.json();
  }

  async function createProject(
    p: Omit<Project, 'id'>,
  ): Promise<Project> {
    const r = await fetch(`${base}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
    if (!r.ok) throw new Error(`createProject failed: ${r.status}`);
    return r.json();
  }

  async function deleteProject(id: string): Promise<void> {
    const r = await fetch(`${base}/projects/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`deleteProject failed: ${r.status}`);
  }

  async function listJenkins(): Promise<JenkinsInstance[]> {
    const r = await fetch(`${base}/jenkins`);
    if (!r.ok) throw new Error(`listJenkins failed: ${r.status}`);
    return r.json();
  }

  async function createJenkins(
    j: JenkinsInstance,
  ): Promise<JenkinsInstance> {
    const r = await fetch(`${base}/jenkins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(j),
    });
    if (!r.ok) throw new Error(`createJenkins failed: ${r.status}`);
    return r.json();
  }

  return { listProjects, createProject, deleteProject, listJenkins, createJenkins };
}
