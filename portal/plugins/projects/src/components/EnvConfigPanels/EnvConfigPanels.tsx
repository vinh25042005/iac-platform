import { useState, useEffect, useCallback } from 'react';
import {
  Button,
  Paper,
  Typography,
  Box,
  TextField,
  CircularProgress,
  Chip,
  FormControlLabel,
  Checkbox,
  Divider,
} from '@material-ui/core';
import { useProjectsApi, Project } from '../../api';

interface EnvConfigData {
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
}

/** Hook dùng chung: tải cấu hình env + trạng thái lưu. */
function useEnvConfig(projectId: string, env: string) {
  const api = useProjectsApi();
  const [cfg, setCfg] = useState<EnvConfigData | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setErr('');
    try {
      setCfg(await api.getEnvConfig(projectId, env));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }, [api, projectId, env]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, projectId, env]);

  const save = useCallback(
    async (patch: Record<string, unknown>) => {
      setBusy(true);
      setMsg('');
      setErr('');
      try {
        const r = await api.updateEnvConfig(projectId, env, patch);
        setMsg(`✅ Đã lưu → ${r.file}`);
        await load();
        setTimeout(() => setMsg(''), 4000);
      } catch (e: any) {
        setErr(e.message);
      } finally {
        setBusy(false);
      }
    },
    [api, projectId, env, load],
  );

  return { cfg, busy, msg, err, setMsg, setErr, load, save };
}

/** Thanh trạng thái dùng chung (path + busy + msg + err). */
function StatusBar({
  cfg,
  busy,
  msg,
  err,
}: {
  cfg: EnvConfigData | null;
  busy: boolean;
  msg: string;
  err: string;
}) {
  return (
    <Box>
      {cfg && (
        <Box mb={1}>
          <Chip size="small" variant="outlined" label={`base: ${cfg.paths.valuesFile}`} />
          <Chip
            size="small"
            variant="outlined"
            label={`env: ${cfg.paths.envFile}`}
            style={{ marginLeft: 8 }}
          />
        </Box>
      )}
      {busy && (
        <Box display="flex" alignItems="center" mt={1}>
          <CircularProgress size={16} style={{ marginRight: 8 }} />
          <Typography variant="caption">Đang xử lý...</Typography>
        </Box>
      )}
      {err && (
        <Box mt={1} p={2} style={{ background: '#fdecea', borderRadius: 4 }}>
          <Typography color="error">{err}</Typography>
        </Box>
      )}
      {msg && (
        <Box mt={1} p={2} style={{ background: '#e8f5e9', borderRadius: 4 }}>
          <Typography style={{ color: '#2e7d32' }}>{msg}</Typography>
        </Box>
      )}
    </Box>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="subtitle2" color="textSecondary" style={{ margin: '16px 0 8px' }}>
      {children}
    </Typography>
  );
}

// ─────────────────────────────── NETWORK ───────────────────────────────
// Chỉ cho phép đổi HOST/DOMAIN của env. Các thông số khác (ingress class, TLS,
// clusterIssuer, NLB...) dùng giá trị mặc định từ helm values — không cần chỉnh.
export const NetworkPanel = ({ project, env }: { project: Project; env: string }) => {
  const { cfg, busy, msg, err, save } = useEnvConfig(project.id, env);
  const [host, setHost] = useState('');

  useEffect(() => {
    if (cfg) setHost(cfg.network.host);
  }, [cfg]);

  if (!cfg)
    return (
      <Paper style={{ padding: 48, marginTop: 16, textAlign: 'center' }}>
        <CircularProgress size={24} />
      </Paper>
    );

  return (
    <Paper style={{ padding: 24, marginBottom: 16 }}>
      <Typography variant="h6" gutterBottom>
        Network &amp; Access
      </Typography>
      <Typography variant="body2" color="textSecondary" gutterBottom>
        Đổi host/domain cho env <b>{env.toUpperCase()}</b> — lưu vào helm values.
      </Typography>

      <Box display="flex" flexWrap="wrap">
        <TextField
          label="Host / Domain"
          size="small"
          value={host}
          onChange={e => setHost(e.target.value)}
          style={{ width: 380 }}
          helperText="Public URL cho env này (VD: app.f5test-dev.vinh.io)"
        />
      </Box>

      <Divider style={{ margin: '16px 0' }} />
      <StatusBar cfg={cfg} busy={busy} msg={msg} err={err} />
      <Box mt={2}>
        <Button
          variant="contained"
          color="primary"
          disabled={busy}
          onClick={() => save({ ingress: { host } })}
        >
          Save Network Config
        </Button>
      </Box>
    </Paper>
  );
};

// ─────────────────────────────── PUBLISH ───────────────────────────────
export const PublishPanel = ({ project, env }: { project: Project; env: string }) => {
  const { cfg, busy, msg, err, save } = useEnvConfig(project.id, env);
  const api = useProjectsApi();
  const [imageRepo, setImageRepo] = useState('docker.io/youruser');
  const [imageTag, setImageTag] = useState('latest');
  const [dh, setDh] = useState<{ path: string; exists: boolean; data: Record<string, string> } | null>(null);
  const [dhBusy, setDhBusy] = useState(false);

  useEffect(() => {
    if (cfg) {
      setImageRepo(cfg.publish.imageRepo);
      setImageTag(cfg.publish.imageTag);
    }
  }, [cfg]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setDhBusy(true);
      try {
        const s = await api.getDockerHubStatus(project.id);
        if (!cancelled) setDh(s);
      } catch {
        /* bỏ qua — PUBLISH vẫn chỉnh image repo/tag được */
      } finally {
        if (!cancelled) setDhBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, project.id]);

  if (!cfg)
    return (
      <Paper style={{ padding: 48, marginTop: 16, textAlign: 'center' }}>
        <CircularProgress size={24} />
      </Paper>
    );

  return (
    <Paper style={{ padding: 24, marginBottom: 16 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="h6">Publish — Registry &amp; Release</Typography>
        <Chip
          size="small"
          color={dh?.exists ? 'primary' : 'default'}
          label={
            dh?.exists ? `DockerHub: đã cấu hình` : 'DockerHub: chưa cấu hình'
          }
        />
      </Box>
      <Typography variant="body2" color="textSecondary" gutterBottom>
        Registry / image / credential cho việc build &amp; publish (liên quan PIPELINE).
      </Typography>

      <SectionTitle>Image Registry</SectionTitle>
      <Box display="flex" flexWrap="wrap">
        <TextField
          label="Registry (user/org)"
          size="small"
          value={imageRepo}
          onChange={e => setImageRepo(e.target.value)}
          style={{ width: 320, marginRight: 16 }}
          helperText="VD: docker.io/vinh2504 — images: <repo>/<project>-backend"
        />
        <TextField
          label="Default Tag"
          size="small"
          value={imageTag}
          onChange={e => setImageTag(e.target.value)}
          style={{ width: 160 }}
          helperText="latest | dev-<n> | release"
        />
      </Box>

      <SectionTitle>DockerHub Credential</SectionTitle>
      <Box p={2} style={{ background: '#f5f5f5', borderRadius: 4 }}>
        <Typography variant="body2">
          <b>Path:</b> {dh?.path ?? 'secret/ci/dockerhub'} (Vault KV {dh?.exists ? 'có' : 'chưa có'})
        </Typography>
        {dhBusy ? (
          <Box display="flex" alignItems="center" mt={1}>
            <CircularProgress size={14} style={{ marginRight: 8 }} />
            <Typography variant="caption">Đang kiểm tra...</Typography>
          </Box>
        ) : dh?.exists ? (
          <Box mt={1}>
            <Chip
              size="small"
              label={`username: ${dh.data.username || '?'}`}
              style={{ marginRight: 8 }}
            />
            <Chip size="small" label="token: •••• (đã set)" />
          </Box>
        ) : (
          <Box mt={1}>
            <Typography variant="body2" color="textSecondary">
              ⚠️ Chưa có credential DockerHub — pipeline sẽ fail ở bước push image.
            </Typography>
            <Typography variant="caption" color="textSecondary" display="block" style={{ marginTop: 4 }}>
              Cách cấu hình: Vault path <b>secret/ci/dockerhub</b> với keys{' '}
              <b>username</b> + <b>token</b> (hoặc bấm ENV VARS → chọn path này, hoặc dùng vault CLI).
            </Typography>
          </Box>
        )}
      </Box>

      <Divider style={{ margin: '16px 0' }} />
      <StatusBar cfg={cfg} busy={busy} msg={msg} err={err} />
      <Box mt={2}>
        <Button
          variant="contained"
          color="primary"
          disabled={busy}
          onClick={() => save({ images: { repo: imageRepo, tag: imageTag } })}
        >
          Save Publish Config
        </Button>
      </Box>
    </Paper>
  );
};

// ─────────────────────────────── MONITOR ───────────────────────────────
export const MonitorPanel = ({ project, env }: { project: Project; env: string }) => {
  const { cfg, busy, msg, err, save } = useEnvConfig(project.id, env);
  const [grafanaHost, setGrafanaHost] = useState('');
  const [promAddress, setPromAddress] = useState('');
  const [ruleGroup, setRuleGroup] = useState('');
  const [hpaEnabled, setHpaEnabled] = useState(true);
  const [hpaMin, setHpaMin] = useState(2);
  const [hpaMax, setHpaMax] = useState(5);
  const [hpaCpu, setHpaCpu] = useState(50);

  useEffect(() => {
    if (cfg) {
      setGrafanaHost(cfg.monitor.grafanaHost);
      setPromAddress(cfg.monitor.prometheusAddress);
      setRuleGroup(cfg.monitor.ruleGroupName);
      setHpaEnabled(cfg.monitor.hpaEnabled);
      setHpaMin(cfg.monitor.hpaMin);
      setHpaMax(cfg.monitor.hpaMax);
      setHpaCpu(cfg.monitor.hpaTargetCPU);
    }
  }, [cfg]);

  if (!cfg)
    return (
      <Paper style={{ padding: 48, marginTop: 16, textAlign: 'center' }}>
        <CircularProgress size={24} />
      </Paper>
    );

  return (
    <Paper style={{ padding: 24, marginBottom: 16 }}>
      <Typography variant="h6" gutterBottom>
        Monitor — Prometheus / Grafana / HPA
      </Typography>
      <Typography variant="body2" color="textSecondary" gutterBottom>
        Giám sát cho env <b>{env.toUpperCase()}</b> — Grafana, Prometheus, alert rules, HPA.
      </Typography>

      <SectionTitle>Grafana / Prometheus</SectionTitle>
      <Box display="flex" flexWrap="wrap">
        <TextField
          label="Grafana Host"
          size="small"
          value={grafanaHost}
          onChange={e => setGrafanaHost(e.target.value)}
          style={{ width: 320, marginRight: 16 }}
          helperText="URL dashboard Grafana"
        />
        <TextField
          label="Prometheus Address"
          size="small"
          value={promAddress}
          onChange={e => setPromAddress(e.target.value)}
          style={{ width: 340 }}
          helperText="Để trống = auto (kube-prometheus)"
        />
      </Box>

      <SectionTitle>Alert Rule</SectionTitle>
      <TextField
        label="Rule Group Name"
        size="small"
        value={ruleGroup}
        onChange={e => setRuleGroup(e.target.value)}
        style={{ width: 320 }}
        helperText="Nhóm PrometheusRule (mặc định = project)"
      />

      <SectionTitle>Autoscaling (HPA)</SectionTitle>
      <FormControlLabel
        control={
          <Checkbox checked={hpaEnabled} onChange={e => setHpaEnabled(e.target.checked)} />
        }
        label="Bật HPA"
      />
      <Box display="flex" flexWrap="wrap" mt={1}>
        <TextField
          label="Min Replicas"
          type="number"
          size="small"
          value={hpaMin}
          onChange={e => setHpaMin(Number(e.target.value))}
          style={{ width: 140, marginRight: 16 }}
        />
        <TextField
          label="Max Replicas"
          type="number"
          size="small"
          value={hpaMax}
          onChange={e => setHpaMax(Number(e.target.value))}
          style={{ width: 140, marginRight: 16 }}
        />
        <TextField
          label="Target CPU %"
          type="number"
          size="small"
          value={hpaCpu}
          onChange={e => setHpaCpu(Number(e.target.value))}
          style={{ width: 140 }}
        />
      </Box>

      <Divider style={{ margin: '16px 0' }} />
      <StatusBar cfg={cfg} busy={busy} msg={msg} err={err} />
      <Box mt={2}>
        <Button
          variant="contained"
          color="primary"
          disabled={busy}
          onClick={() =>
            save({
              monitoring: {
                grafanaHost,
                prometheusAddress: promAddress,
                ruleGroupName: ruleGroup,
              },
              hpa: {
                enabled: hpaEnabled,
                minReplicas: hpaMin,
                maxReplicas: hpaMax,
                targetCPU: hpaCpu,
              },
            })
          }
        >
          Save Monitor Config
        </Button>
      </Box>
    </Paper>
  );
};
