import { useState, useEffect } from 'react';
import {
  Button,
  Paper,
  Typography,
  Box,
  Chip,
  List,
  ListItem,
  ListItemText,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
} from '@material-ui/core';
import { useProjectsApi, Project } from '../../api';

/**
 * JenkinsPanel — tab PIPELINE: hiển thị Jenkins job `<slug>-ci` của project.
 *   - Mỗi project được tạo ra → backend tự tạo job này.
 *   - Cho phép: tạo job (nếu chưa), xoá job, trigger build (ENV + MODE), xem log.
 */
export const JenkinsPanel = ({ project, env }: { project: Project; env: string }) => {
  const api = useProjectsApi();
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [buildEnv, setBuildEnv] = useState(env);
  const [buildMode, setBuildMode] = useState('full');
  const [logView, setLogView] = useState<{ number: number; log: string } | null>(null);

  const load = async (silent = false) => {
    if (!silent) setBusy(true);
    setErr('');
    try {
      const s = await api.getJenkinsJob(project.id);
      setStatus(s);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      if (!silent) setBusy(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, project.id]);

  const createJob = async () => {
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      const r = await api.createJenkinsJob(project.id);
      setMsg(`✅ Đã tạo job Jenkins: ${r.name}`);
      await load(true);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteJob = async () => {
    if (!window.confirm(`Xoá job Jenkins "${status?.name}"?`)) return;
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      await api.deleteJenkinsJob(project.id);
      setMsg('✅ Đã xoá job Jenkins');
      setStatus((s: any) => ({ ...s, exists: false, builds: [], lastBuild: null }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const triggerBuild = async () => {
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      const r = await api.triggerJenkinsBuild(project.id, buildEnv, buildMode);
      setMsg(`🚀 Đã trigger build ${r.name} (${buildEnv}/${buildMode}) — đang chạy...`);
      setTimeout(() => load(true), 4000);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const viewLog = async (n: number) => {
    setLogView(null);
    setErr('');
    try {
      const log = await api.getJenkinsBuildLog(project.id, n);
      setLogView({ number: n, log });
    } catch (e: any) {
      setErr(e.message);
    }
  };

  return (
    <Paper style={{ padding: 24, marginBottom: 16 }}>
      <Typography variant="h6" gutterBottom>
        Jenkins CI/CD
      </Typography>

      {!status ? (
        <CircularProgress size={20} />
      ) : (
        <>
          {!status.enabled && (
            <Typography variant="body2" color="error" gutterBottom>
              ⚠️ Jenkins chưa cấu hình — backend cần set <b>JENKINS_USER</b> +{' '}
              <b>JENKINS_TOKEN</b> (và mở SG 9090 cho IP portal).
            </Typography>
          )}

          <Box display="flex" alignItems="center" flexWrap="wrap" mb={1}>
            <Typography variant="body2" style={{ marginRight: 8 }}>
              Job: <b>{status.name}</b>
            </Typography>
            <Chip
              size="small"
              style={{ marginRight: 8 }}
              label={status.exists ? 'đã tạo' : 'chưa tạo'}
              color={status.exists ? 'primary' : 'default'}
            />
            {status.lastBuild && (
              <Chip
                size="small"
                label={`#${status.lastBuild.number} · ${status.lastBuild.result || 'running'}`}
                color={
                  status.lastBuild.result === 'SUCCESS'
                    ? 'primary'
                    : status.lastBuild.result
                    ? 'secondary'
                    : 'default'
                }
              />
            )}
          </Box>

          {status.exists && (
            <Box mt={2} display="flex" alignItems="flex-end" flexWrap="wrap">
              <FormControl style={{ minWidth: 110, marginRight: 8 }}>
                <InputLabel>ENV</InputLabel>
                <Select
                  value={buildEnv}
                  onChange={e => setBuildEnv(String(e.target.value))}
                >
                  {['dev', 'stg', 'prd'].map(e => (
                    <MenuItem key={e} value={e}>
                      {e.toUpperCase()}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl style={{ minWidth: 110, marginRight: 8 }}>
                <InputLabel>MODE</InputLabel>
                <Select
                  value={buildMode}
                  onChange={e => setBuildMode(String(e.target.value))}
                >
                  {['full', 'ci', 'release'].map(m => (
                    <MenuItem key={m} value={m}>
                      {m}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button
                variant="contained"
                color="primary"
                disabled={busy || !status.enabled}
                onClick={triggerBuild}
              >
                ▶ Build
              </Button>
            </Box>
          )}

          <Box mt={2} display="flex" flexWrap="wrap">
            {!status.exists && (
              <Button
                variant="contained"
                color="primary"
                disabled={busy || !status.enabled}
                onClick={createJob}
                style={{ marginRight: 8 }}
              >
                Tạo job Jenkins
              </Button>
            )}
            {status.exists && (
              <Button
                variant="contained"
                color="secondary"
                disabled={busy}
                onClick={deleteJob}
                style={{ marginRight: 8 }}
              >
                Xoá job
              </Button>
            )}
            <Button variant="outlined" disabled={busy} onClick={() => load()}>
              Refresh
            </Button>
          </Box>

          {msg && (
            <Typography variant="body2" style={{ color: '#2e7d32', marginTop: 8 }}>
              {msg}
            </Typography>
          )}
          {err && (
            <Typography variant="body2" color="error" style={{ marginTop: 8 }}>
              {err}
            </Typography>
          )}

          {status.builds.length > 0 && (
            <Box mt={2}>
              <Typography variant="subtitle2">Builds gần đây</Typography>
              <List dense>
                {status.builds.map((b: any) => (
                  <ListItem key={b.number} dense style={{ paddingLeft: 0 }}>
                    <ListItemText
                      primary={`#${b.number} — ${b.result || 'running'}`}
                      secondary={b.timestamp ? new Date(b.timestamp).toLocaleString() : ''}
                    />
                    <Button size="small" onClick={() => viewLog(b.number)}>
                      Log
                    </Button>
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
        </>
      )}

      <Dialog
        open={!!logView}
        onClose={() => setLogView(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Build #{logView?.number} — Console Log</DialogTitle>
        <DialogContent>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontSize: 12,
              maxHeight: 400,
              overflow: 'auto',
              background: '#111',
              color: '#eee',
              padding: 12,
              borderRadius: 4,
            }}
          >
            {logView?.log}
          </pre>
        </DialogContent>
      </Dialog>
    </Paper>
  );
};
