import { useEffect, useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Typography,
  Button,
  CircularProgress,
  Box,
  Chip,
  MenuItem,
  Select,
} from '@material-ui/core';
import { Header, Container } from '@backstage/ui';
import { useProjectsApi, Project } from '../../api';
import { CreateProjectPage } from '../CreateProjectPage/CreateProjectPage';
import { ApplyLogDialog } from '../ApplyLogDialog/ApplyLogDialog';
import { ProjectDetailsPage } from '../ProjectDetailsPage/ProjectDetailsPage';

export const ProjectsListPage = () => {
  const api = useProjectsApi();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  // Điều hướng nội bộ: đang xem chi tiết project nào (null = ở danh sách)
  const [detailsProject, setDetailsProject] = useState<Project | null>(null);
  const [iaState, setIaState] = useState<Record<string, { loading: boolean; msg: string }>>({});
  const [applyEnv, setApplyEnv] = useState<Record<string, string>>({});
  const [applyTarget, setApplyTarget] = useState<{ id: string; name: string; env: string } | null>(null);
  const [destroyTarget, setDestroyTarget] = useState<{ id: string; name: string; env: string } | null>(null);
  // Các job apply/destroy (đang/đã chạy) — để hiện badge + mở lại log nếu lỡ đóng dialog
  const [jobs, setJobs] = useState<
    { id: string; status: string; project: string; env: string; mode: string }[]
  >([]);
  const [logTarget, setLogTarget] = useState<
    | { id: string; name: string; env: string; jobId: string; mode: 'apply' | 'destroy' }
    | null
  >(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      setProjects(await api.listProjects());
    } catch (e: any) {
      setError(`Lỗi tải danh sách project: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  // Poll danh sách job mỗi 5s → cập nhật badge "đang chạy" + nút mở lại log
  async function loadJobs() {
    try {
      const all = await api.listApplyJobs();
      setJobs(all);
    } catch (e) {
      /* im lặng — job chỉ là phụ, không làm hỏng UI */
    }
  }

  useEffect(() => {
    load();
    loadJobs();
    const t = setInterval(loadJobs, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  async function handleDelete(id: string) {
    try {
      await api.deleteProject(id);
      await load();
    } catch (e: any) {
      setError(`Xóa thất bại: ${e.message}`);
    }
  }

  // Lazy-load component Create khi cần (import() động — chuẩn ESM/Rspack)
  function handleCreated() {
    setShowCreate(false);
    load();
  }

  async function handleGenerateIac(id: string) {
    setIaState(s => ({ ...s, [id]: { loading: true, msg: '' } }));
    try {
      const files = await api.generateProject(id);
      setIaState(s => ({
        ...s,
        [id]: { loading: false, msg: `✅ Đã sinh ${files.length} file IaC` },
      }));
    } catch (e: any) {
      setIaState(s => ({ ...s, [id]: { loading: false, msg: `❌ ${e.message}` } }));
    }
  }

  // Điều hướng nội bộ ưu tiên: chi tiết project → create → danh sách
  if (detailsProject) {
    return (
      <ProjectDetailsPage
        project={detailsProject}
        onBack={() => setDetailsProject(null)}
      />
    );
  }

  if (showCreate) {
    return <CreateProjectPage onCreated={handleCreated} />;
  }

  function renderBody() {
    if (loading) {
      return (
        <TableRow>
          <TableCell colSpan={7} align="center">
            <CircularProgress size={24} />
          </TableCell>
        </TableRow>
      );
    }
    if (projects.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={7} align="center">
            <Typography color="textSecondary">
              Chưa có project nào — bấm "+ Add Project" để tạo.
            </Typography>
          </TableCell>
        </TableRow>
      );
    }
    return projects.map(p => (
      <TableRow key={p.id}>
        <TableCell>{p.id}</TableCell>
        <TableCell>
          <Button
            size="small"
            style={{
              textTransform: 'none',
              fontWeight: 600,
              padding: 0,
              minWidth: 0,
              cursor: 'pointer',
            }}
            onClick={() => setDetailsProject(p)}
          >
            {p.name}
          </Button>
        </TableCell>
        <TableCell>{p.owner}</TableCell>
        <TableCell>{p.jenkinsInstance}</TableCell>
        <TableCell>
          <Chip
            size="small"
            label={p.status}
            color={p.status === 'active' ? 'primary' : 'default'}
          />
        </TableCell>
        <TableCell>
          <IconButton size="small" onClick={() => handleDelete(p.id)}>
            <Typography variant="body2">🗑</Typography>
          </IconButton>
        </TableCell>
        <TableCell>
          <Box display="flex" flexDirection="column" alignItems="flex-start">
            <Box display="flex">
              <Button
                size="small"
                variant="outlined"
                onClick={() => setDetailsProject(p)}
                style={{ marginRight: 4 }}
              >
                Details
              </Button>
              <Button
                size="small"
                variant="outlined"
                disabled={iaState[p.id]?.loading}
                onClick={() => handleGenerateIac(p.id)}
                style={{ marginRight: 4 }}
              >
                {iaState[p.id]?.loading ? '…' : 'IaC'}
              </Button>
              <Select
                size="small"
                value={applyEnv[p.id] ?? 'dev'}
                onChange={e =>
                  setApplyEnv(s => ({ ...s, [p.id]: String(e.target.value) }))
                }
                style={{ minWidth: 70, marginRight: 4 }}
              >
                <MenuItem value="dev">dev</MenuItem>
                <MenuItem value="stg">stg</MenuItem>
                <MenuItem value="prd">prd</MenuItem>
              </Select>
              <Button
                size="small"
                variant="contained"
                color="primary"
                onClick={() =>
                  setApplyTarget({
                    id: p.id,
                    name: p.name,
                    env: applyEnv[p.id] ?? 'dev',
                  })
                }
              >
                Apply
              </Button>
              <Button
                size="small"
                variant="contained"
                color="secondary"
                style={{ marginLeft: 4 }}
                onClick={() =>
                  setDestroyTarget({
                    id: p.id,
                    name: p.name,
                    env: applyEnv[p.id] ?? 'dev',
                  })
                }
              >
                Destroy
              </Button>
              {/* Nút mở lại log job của project này (đang chạy hoặc đã xong) */}
              {jobs
                .filter(j => j.project === p.slug)
                .slice(0, 3)
                .map(j => (
                  <Button
                    key={j.id}
                    size="small"
                    variant="outlined"
                    color={j.status === 'running' ? 'primary' : 'default'}
                    style={{ marginLeft: 4 }}
                    onClick={() =>
                      setLogTarget({
                        id: p.id,
                        name: p.name,
                        env: j.env,
                        jobId: j.id,
                        mode: j.mode === 'destroy' ? 'destroy' : 'apply',
                      })
                    }
                  >
                    {j.status === 'running' ? '🟢' : '📄'} {j.env}:{j.mode === 'destroy' ? 'dest' : 'ap'}
                  </Button>
                ))}
            </Box>
            {jobs.some(j => j.project === p.slug && j.status === 'running') && (
              <Typography variant="caption" style={{ color: '#2e7d32' }}>
                ● Đang chạy terraform — bấm nút xanh để xem log realtime
              </Typography>
            )}
            {iaState[p.id]?.msg && (
              <Typography variant="caption" color="textSecondary">
                {iaState[p.id].msg}
              </Typography>
            )}
          </Box>
        </TableCell>
      </TableRow>
    ));
  }

  return (
    <>
      <Header title="Projects" description="Manage infrastructure projects across all environments" />
      <Container>
        {error && (
          <Box mb={2} p={2} style={{ background: '#fdecea', borderRadius: 4 }}>
            <Typography color="error">{error}</Typography>
          </Box>
        )}

        <Box display="flex" justifyContent="flex-end" mb={2}>
          <Button
            variant="contained"
            color="primary"
            onClick={load}
            style={{ marginRight: 8 }}
          >
            Refresh
          </Button>
          <Button variant="contained" color="primary" onClick={() => setShowCreate(true)}>
            + Add Project
          </Button>
        </Box>

        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Owner</TableCell>
                <TableCell>Jenkins</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Delete</TableCell>
                <TableCell>IaC / Apply</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>{renderBody()}</TableBody>
          </Table>
        </TableContainer>
      </Container>

      {applyTarget && (
        <ApplyLogDialog
          open
          projectId={applyTarget.id}
          projectName={applyTarget.name}
          env={applyTarget.env}
          mode="apply"
          onClose={() => setApplyTarget(null)}
        />
      )}
      {destroyTarget && (
        <ApplyLogDialog
          open
          projectId={destroyTarget.id}
          projectName={destroyTarget.name}
          env={destroyTarget.env}
          mode="destroy"
          onClose={() => setDestroyTarget(null)}
        />
      )}
      {/* Mở lại log của job đã có (lỡ đóng dialog) — view mode, không start mới */}
      {logTarget && (
        <ApplyLogDialog
          open
          projectId={logTarget.id}
          projectName={logTarget.name}
          env={logTarget.env}
          mode={logTarget.mode}
          initialJobId={logTarget.jobId}
          onClose={() => setLogTarget(null)}
        />
      )}
    </>
  );
};
