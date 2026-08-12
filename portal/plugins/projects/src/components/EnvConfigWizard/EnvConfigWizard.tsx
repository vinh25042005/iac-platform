import { useEffect, useState } from 'react';
import {
  Button,
  Paper,
  Typography,
  Grid,
  Box,
  TextField,
  FormControlLabel,
  Checkbox,
  Chip,
  Tabs,
  Tab,
  Select,
  InputLabel,
  FormControl,
  MenuItem,
  IconButton,
  CircularProgress,
} from '@material-ui/core';
import { Header, Container } from '@backstage/ui';
import { useProjectsApi, Project } from '../../api';
import { ApplyLogDialog } from '../ApplyLogDialog/ApplyLogDialog';
import { JenkinsPanel } from '../JenkinsPanel/JenkinsPanel';
import {
  NetworkPanel,
  PublishPanel,
  MonitorPanel,
} from '../EnvConfigPanels/EnvConfigPanels';

const TABS = [
  'SETUP',
  'ENV VARS',
  'INFRA',
  'PIPELINE',
  'NETWORK',
  'PUBLISH',
  'MONITOR',
];

interface ServiceOption {
  key: string;
  label: string;
  module: string;
}

// Service Selection — chỉ 3 component chính (backend/frontend/database)
const SERVICES: ServiceOption[] = [
  { key: 'backend', label: 'Backend', module: 'backend' },
  { key: 'frontend', label: 'Frontend', module: 'frontend' },
  { key: 'database', label: 'Database', module: 'postgres' },
];

/**
 * EnvConfigWizard — cấu hình 1 env của project.
 * Shell 7 tab: SETUP | ENV VARS | INFRA | PIPELINE | NETWORK | PUBLISH | MONITOR.
 * Tất cả 7 tab đều có UI đầy đủ (SETUP/ENV VARS/INFRA/PIPELINE/NETWORK/PUBLISH/MONITOR).
 */
export const EnvConfigWizard = ({
  project,
  env,
  onBack,
}: {
  project: Project;
  env: string;
  onBack: () => void;
}) => {
  const api = useProjectsApi();
  const [tab, setTab] = useState(0);
  const [namespace, setNamespace] = useState(`${project.slug}-${env}`);
  const [registry, setRegistry] = useState('docker.io/youruser');
  const [vaultProfile, setVaultProfile] = useState('Vault');
  const [cluster, setCluster] = useState(`${project.slug}-${env}-cluster`);
  // Chỉ bật các service project đã chọn lúc tạo (mặc định backend/frontend/database)
  const defaultServices = project.services?.length
    ? project.services
    : ['backend', 'frontend', 'database'];
  const [services, setServices] = useState<Record<string, boolean>>(
    Object.fromEntries(SERVICES.map(s => [s.key, defaultServices.includes(s.key)])),
  );
  const [saved, setSaved] = useState('');

  // ── ENV VARS (Vault — Global Application Secrets) ──
  const [secretRows, setSecretRows] = useState<{ key: string; value: string }[]>([]);
  const [vaultAddr, setVaultAddr] = useState('https://52.221.18.86:8200');
  const [vaultPath, setVaultPath] = useState(`secret/${project.slug}/${env}`);
  const [vaultVersion, setVaultVersion] = useState('');
  const [vaultMsg, setVaultMsg] = useState('');
  const [vaultError, setVaultError] = useState('');
  const [vaultBusy, setVaultBusy] = useState(false);
  const [showValues, setShowValues] = useState(false);

  // ── INFRA (Terraform Orchestrator) ──
  const [infraTarget, setInfraTarget] = useState<
    { mode: 'apply' | 'destroy' | 'init' | 'plan' } | null
  >(null);

  // Khi mở tab ENV VARS → tự tải secrets từ Vault
  useEffect(() => {
    if (tab !== 1) return;
    let cancelled = false;
    setVaultBusy(true);
    api
      .listVaultSecrets(project.id, env)
      .then(info => {
        if (cancelled) return;
        setVaultAddr(info.addr);
        setVaultPath(info.path);
        setVaultVersion(info.version);
        setSecretRows(Object.entries(info.data).map(([key, value]) => ({ key, value })));
        setVaultError('');
      })
      .catch((e: any) => {
        if (cancelled) return;
        setVaultError(e.message);
      })
      .finally(() => !cancelled && setVaultBusy(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, api]);

  function save() {
    const count = Object.entries(services).filter(([, v]) => v).length;
    setSaved(
      `✅ Saved ${env.toUpperCase()} config — namespace ${namespace}, ${count} service(s)`,
    );
    setTimeout(() => setSaved(''), 4000);
  }

  // ── ENV VARS helpers ──
  function updateSecret(i: number, field: 'key' | 'value', v: string) {
    setSecretRows(rows => rows.map((r, idx) => (idx === i ? { ...r, [field]: v } : r)));
  }
  function addSecret() {
    setSecretRows(rows => [...rows, { key: '', value: '' }]);
  }
  function removeSecret(i: number) {
    setSecretRows(rows => rows.filter((_, idx) => idx !== i));
  }
  async function loadSecretsFromVault() {
    setVaultBusy(true);
    setVaultMsg('');
    try {
      const info = await api.listVaultSecrets(project.id, env);
      setVaultAddr(info.addr);
      setVaultPath(info.path);
      setVaultVersion(info.version);
      setSecretRows(Object.entries(info.data).map(([key, value]) => ({ key, value })));
      setVaultError('');
      setVaultMsg(`Đã tải secrets từ ${info.path}`);
    } catch (e: any) {
      setVaultError(e.message);
    } finally {
      setVaultBusy(false);
    }
  }
  async function pushSecrets() {
    const data = Object.fromEntries(
      secretRows.filter(r => r.key.trim()).map(r => [r.key.trim(), r.value]),
    );
    setVaultBusy(true);
    setVaultMsg('');
    try {
      await api.pushVaultSecrets(project.id, env, data);
      setVaultMsg(`✅ Đã push ${Object.keys(data).length} secret lên Vault (${vaultPath})`);
    } catch (e: any) {
      setVaultError(e.message);
    } finally {
      setVaultBusy(false);
    }
  }
  async function syncSecrets() {
    setVaultBusy(true);
    setVaultMsg('');
    try {
      const res = await api.syncVaultToK8s(project.id, env, namespace);
      setVaultMsg(
        `✅ Đã sync Vault → K8s Secret "${res.secretName}" trong namespace "${res.namespace}"`,
      );
    } catch (e: any) {
      setVaultError(e.message);
    } finally {
      setVaultBusy(false);
    }
  }

  return (
    <>
      <Header
        title={`${env.toUpperCase()} Configuration`}
        description={`${project.name} — Configure infrastructure & CI/CD parameters`}
      />
      <Container>
        <Box mb={2}>
          <Button onClick={onBack} size="small">
            ← Back to Environments
          </Button>
        </Box>

        <Paper>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            variant="scrollable"
            scrollButtons="auto"
            indicatorColor="primary"
            textColor="primary"
          >
            {TABS.map(t => (
              <Tab key={t} label={t} />
            ))}
          </Tabs>
        </Paper>

        {tab === 0 && (
          <Box mt={2}>
            {/* ── Project Metadata ── */}
            <Paper style={{ padding: 24, marginBottom: 16 }}>
              <Typography variant="h6" gutterBottom>
                Project Metadata
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6} md={3}>
                  <Typography variant="body2" color="textSecondary">
                    Environment Name
                  </Typography>
                  <Typography variant="h6">{env.toUpperCase()}</Typography>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <TextField
                    label="Target Namespace"
                    fullWidth
                    value={namespace}
                    onChange={e => setNamespace(e.target.value)}
                    helperText="Namespace app trong cluster"
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <Typography variant="body2" color="textSecondary">
                    Project Slug
                  </Typography>
                  <Typography variant="h6">{project.slug}</Typography>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <TextField
                    label="Registry URL"
                    fullWidth
                    value={registry}
                    onChange={e => setRegistry(e.target.value)}
                    helperText="Docker registry user/org"
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <Typography variant="body2" color="textSecondary">
                    AWS Key Pair
                  </Typography>
                  <Typography>{project.keyName}</Typography>
                </Grid>
              </Grid>
            </Paper>

            {/* ── Integration Profiles ── */}
            <Paper style={{ padding: 24, marginBottom: 16 }}>
              <Typography variant="h6" gutterBottom>
                Integration Profiles
              </Typography>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                Profiles mapped for syncing &amp; monitoring
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Vault Profile (Secret Storage)</InputLabel>
                    <Select
                      value={vaultProfile}
                      onChange={e => setVaultProfile(String(e.target.value))}
                    >
                      <MenuItem value="Vault">
                        Vault (52.221.18.86:8200)
                      </MenuItem>
                      <MenuItem value="None">None</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Kubernetes Cluster (Monitoring)</InputLabel>
                    <Select
                      value={cluster}
                      onChange={e => setCluster(String(e.target.value))}
                    >
                      <MenuItem value={`${project.slug}-${env}-cluster`}>
                        {project.slug}-{env}-cluster
                      </MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
            </Paper>

            {/* ── Service Selection ── */}
            <Paper style={{ padding: 24, marginBottom: 16 }}>
              <Typography variant="h6" gutterBottom>
                Service Selection
              </Typography>
              <Grid container spacing={1}>
                {SERVICES.map(s => (
                  <Grid item xs={12} sm={6} md={4} key={s.key}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={!!services[s.key]}
                          onChange={e =>
                            setServices(x => ({
                              ...x,
                              [s.key]: e.target.checked,
                            }))
                          }
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="body1">{s.label}</Typography>
                          <Typography variant="caption" color="textSecondary">
                            {s.module} module
                          </Typography>
                        </Box>
                      }
                    />
                  </Grid>
                ))}
              </Grid>
            </Paper>

            {/* ── Save ── */}
            <Box display="flex" justifyContent="flex-end" mb={4}>
              {saved && (
                <Box mr={2}>
                  <Chip label={saved} color="primary" />
                </Box>
              )}
              <Button variant="contained" color="primary" onClick={save}>
                Save Configuration
              </Button>
            </Box>
          </Box>
        )}

        {tab === 1 && (
          <Box mt={2}>
            {/* ── Global Application Secrets ── */}
            <Paper style={{ padding: 24, marginBottom: 16 }}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                <Typography variant="h6">Global Application Secrets</Typography>
                <Box>
                  <Chip size="small" variant="outlined" label={`Vault: ${vaultAddr}`} />
                  {vaultVersion && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`KV ${vaultVersion}`}
                      style={{ marginLeft: 8 }}
                    />
                  )}
                </Box>
              </Box>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                Path: <b>{vaultPath}</b> · namespace: <b>{namespace}</b>
              </Typography>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                Global Sync = Vault → K8s Secret · Global Push = config → Vault
              </Typography>

              {vaultError && (
                <Box mt={1} mb={1} p={2} style={{ background: '#fdecea', borderRadius: 4 }}>
                  <Typography color="error">{vaultError}</Typography>
                </Box>
              )}

              <Box mt={2} mb={1} display="flex" alignItems="center" justifyContent="space-between">
                <Typography variant="subtitle2">Secrets</Typography>
                <Box>
                  <Button size="small" onClick={() => setShowValues(v => !v)}>
                    {showValues ? 'Ẩn giá trị' : 'Hiện giá trị'}
                  </Button>
                  <Button size="small" onClick={loadSecretsFromVault}>
                    Tải lại từ Vault
                  </Button>
                </Box>
              </Box>

              {vaultBusy ? (
                <Box textAlign="center" py={3}>
                  <CircularProgress size={24} />
                </Box>
              ) : (
                <>
                  {secretRows.map((row, i) => (
                    <Box key={i} display="flex" mb={1} alignItems="center">
                      <TextField
                        label="Key"
                        size="small"
                        value={row.key}
                        onChange={e => updateSecret(i, 'key', e.target.value)}
                        style={{ flex: 1, marginRight: 8 }}
                      />
                      <TextField
                        label="Value"
                        size="small"
                        type={showValues ? 'text' : 'password'}
                        value={row.value}
                        onChange={e => updateSecret(i, 'value', e.target.value)}
                        style={{ flex: 1, marginRight: 8 }}
                      />
                      <IconButton size="small" onClick={() => removeSecret(i)}>
                        <Typography variant="body2">🗑</Typography>
                      </IconButton>
                    </Box>
                  ))}
                  <Button size="small" onClick={addSecret}>
                    + Thêm secret
                  </Button>
                </>
              )}
            </Paper>

            {/* ── Master Vault ── */}
            <Paper style={{ padding: 24, marginBottom: 16 }}>
              <Typography variant="h6" gutterBottom>
                Master Vault
              </Typography>
              <Box mt={1} display="flex" flexWrap="wrap">
                <Button
                  variant="outlined"
                  color="primary"
                  disabled={vaultBusy}
                  onClick={loadSecretsFromVault}
                  style={{ marginRight: 8 }}
                >
                  Load from Vault
                </Button>
                <Button
                  variant="contained"
                  color="primary"
                  disabled={vaultBusy}
                  onClick={pushSecrets}
                  style={{ marginRight: 8 }}
                >
                  Push to Vault
                </Button>
                <Button
                  variant="contained"
                  color="secondary"
                  disabled={vaultBusy}
                  onClick={syncSecrets}
                  style={{ marginLeft: 8 }}
                >
                  Sync to K8s
                </Button>
              </Box>
              {vaultMsg && (
                <Box mt={2} p={2} style={{ background: '#e8f5e9', borderRadius: 4 }}>
                  <Typography style={{ color: '#2e7d32' }}>{vaultMsg}</Typography>
                </Box>
              )}
            </Paper>
          </Box>
        )}

        {tab === 2 && (
          <Box mt={2}>
            {/* ── Terraform Orchestrator ── */}
            <Paper style={{ padding: 24, marginBottom: 16 }}>
              <Typography variant="h6" gutterBottom>
                Terraform Orchestrator
              </Typography>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                Thư mục: <b>terraform/environments/{project.slug}/{env}</b>
              </Typography>
              <Box mt={2} display="flex" flexWrap="wrap">
                <Button
                  variant="outlined"
                  onClick={() => setInfraTarget({ mode: 'init' })}
                  style={{ marginRight: 8 }}
                >
                  INIT
                </Button>
                <Button
                  variant="outlined"
                  onClick={() => setInfraTarget({ mode: 'plan' })}
                  style={{ marginRight: 8 }}
                >
                  PLAN
                </Button>
                <Button
                  variant="contained"
                  color="primary"
                  onClick={() => setInfraTarget({ mode: 'apply' })}
                  style={{ marginRight: 8 }}
                >
                  APPLY
                </Button>
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={() => setInfraTarget({ mode: 'destroy' })}
                >
                  DESTROY
                </Button>
              </Box>
            </Paper>
          </Box>
        )}

        {tab === 3 && <JenkinsPanel project={project} env={env} />}
        {tab === 4 && <NetworkPanel project={project} env={env} />}
        {tab === 5 && <PublishPanel project={project} env={env} />}
        {tab === 6 && <MonitorPanel project={project} env={env} />}
      </Container>

      {/* Dialog log realtime cho INIT/PLAN/APPLY/DESTROY */}
      {infraTarget && (
        <ApplyLogDialog
          open
          projectId={project.id}
          projectName={project.name}
          env={env}
          mode={infraTarget.mode}
          onClose={() => setInfraTarget(null)}
        />
      )}
    </>
  );
};
