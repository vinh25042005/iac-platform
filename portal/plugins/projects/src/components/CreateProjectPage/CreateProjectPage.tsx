import { useEffect, useState } from 'react';
import {
  Button,
  TextField,
  MenuItem,
  Grid,
  Paper,
  Typography,
  CircularProgress,
  Box,
  Stepper,
  Step,
  StepLabel,
  Checkbox,
  FormControlLabel,
  Divider,
  Chip,
  Select,
  InputLabel,
  FormControl,
} from '@material-ui/core';
import { Header, Container } from '@backstage/ui';
import { useProjectsApi, JenkinsInstance } from '../../api';

interface FormState {
  name: string;
  slug: string;
  owner: string;
  jenkinsInstance: string;
  keyName: string;
  status: string;
  repoUrl: string;
  nodeCount: number;
  masterNodeIndex: number;
  instanceType: string;
  appRepo: string;
  registryBase: string;
  imageRepoPrefix: string;
  vaultEip: string;
  deployBranch: string;
}

// GitOps repo mặc định — repo chứa helm/_base + argocd/apps (ArgoCD sẽ clone).
// Người dùng có thể đổi sang repo riêng của team.
const DEFAULT_REPO_URL = 'https://github.com/vinh25042005/iac-platform.git';

const emptyForm: FormState = {
  name: '',
  slug: '',
  owner: '',
  jenkinsInstance: '',
  keyName: 'techshop-key',
  status: 'active',
  repoUrl: DEFAULT_REPO_URL,
  nodeCount: 3,
  masterNodeIndex: 0,
  instanceType: 't3.small',
  appRepo: '',
  registryBase: 'docker.io/vinh2504',
  imageRepoPrefix: '',
  vaultEip: '52.221.18.86',
  deployBranch: 'week-6-argo-rollouts',
};

const NODE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const INSTANCE_TYPES = ['t3.small', 't3.medium', 't3.large', 't3.xlarge', 't4g.small', 't4g.medium'];

const ENV_OPTIONS = ['dev', 'stg', 'prd'];
const SERVICE_OPTIONS = ['backend', 'frontend', 'database', 'rancher'];
const STEPS = ['Project Details', 'Environments & Services', 'Integration & Review'];

export const CreateProjectPage = ({ onCreated }: { onCreated?: () => void }) => {
  const api = useProjectsApi();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [jenkinsList, setJenkinsList] = useState<JenkinsInstance[]>([]);
  const [jenkinsLoaded, setJenkinsLoaded] = useState(false);
  const [showNewJenkins, setShowNewJenkins] = useState(false);
  const [newJenkinsName, setNewJenkinsName] = useState('');
  const [newJenkinsUrl, setNewJenkinsUrl] = useState('');
  const [step, setStep] = useState(0);
  const [envs, setEnvs] = useState<string[]>(['dev', 'stg', 'prd']);
  const [services, setServices] = useState<string[]>(['backend', 'frontend', 'database']);
  const [registry, setRegistry] = useState('docker.io/youruser');
  const [vaultProfile, setVaultProfile] = useState('Vault');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .listJenkins()
      .then(list => {
        setJenkinsList(list);
        if (list.length > 0) {
          setForm(f => ({ ...f, jenkinsInstance: list[0].name }));
        }
      })
      .catch(e => setError(`Không tải được danh sách Jenkins: ${e.message}`))
      .finally(() => setJenkinsLoaded(true));
  }, [api]);  

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (k === 'slug') {
      // Tự động chuẩn hoá slug ngay khi gõ: lowercase + space→dash + chỉ giữ a-z0-9-
      const v = e.target.value.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
      setForm(f => ({ ...f, slug: v }));
    } else {
      setForm(f => ({ ...f, [k]: e.target.value }));
    }
  };

  async function handleCreateJenkins() {
    if (!newJenkinsName.trim() || !newJenkinsUrl.trim()) {
      setError('Nhập cả tên và URL cho Jenkins mới');
      return;
    }
    try {
      const created = await api.createJenkins({
        name: newJenkinsName.trim(),
        url: newJenkinsUrl.trim(),
      });
      setJenkinsList(l => [...l, created]);
      setForm(f => ({ ...f, jenkinsInstance: created.name }));
      setShowNewJenkins(false);
      setNewJenkinsName('');
      setNewJenkinsUrl('');
      setError('');
    } catch (e: any) {
      setError(`Tạo Jenkins thất bại: ${e.message}`);
    }
  }

  function toggle(arr: string[], v: string, setArr: (a: string[]) => void) {
    setArr(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
  }

  function canNext() {
    if (step === 0) {
      return !!(form.name.trim() && form.slug.trim() && form.owner.trim());
    }
    if (step === 1) {
      return envs.length > 0 && services.length > 0;
    }
    return true;
  }

  async function handleSubmit() {
    setError('');
    if (!form.name.trim() || !form.slug.trim() || !form.owner.trim()) {
      setError('Vui lòng điền đủ: Project Name, Slug, Owner');
      return;
    }
    // Đảm bảo slug hợp lệ (không space, không ký tự lạ) — chặn từ phía UI
    const cleanSlug = form.slug.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (cleanSlug !== form.slug) {
      setForm(f => ({ ...f, slug: cleanSlug }));
      setError('Slug đã được chuẩn hoá tự động (bỏ space/ký tự đặc biệt)');
      return;
    }
    if (!form.jenkinsInstance) {
      setError('Chọn hoặc tạo mới Jenkins Instance');
      return;
    }
    if (envs.length === 0) {
      setError('Chọn ít nhất 1 environment');
      return;
    }
    setSubmitting(true);
    try {
      await api.createProject({ ...form, envs, services });
      setForm(emptyForm);
      setStep(0);
      onCreated?.();
      setError('✅ Đã tạo project thành công!');
    } catch (e: any) {
      setError(`Tạo project thất bại: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Header title="Create Project" description="Tạo project mới trên iac-platform" />
      <Container>
        <Paper style={{ padding: 24, maxWidth: 920 }}>
          <Stepper activeStep={step} alternativeLabel>
            {STEPS.map(l => (
              <Step key={l}>
                <StepLabel>{l}</StepLabel>
              </Step>
            ))}
          </Stepper>

          {error && (
            <Box mb={2} p={2} style={{ background: '#fdecea', borderRadius: 4 }}>
              <Typography color="error">{error}</Typography>
            </Box>
          )}

          {step === 0 && (
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Project Name"
                fullWidth
                value={form.name}
                onChange={set('name')}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Namespace"
                fullWidth
                value={form.slug}
                onChange={set('slug')}
                helperText="Dùng làm namespace cho mỗi env (VD: test3-dev)"
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                label="Project Owner"
                fullWidth
                value={form.owner}
                onChange={set('owner')}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="AWS Key Pair"
                fullWidth
                value={form.keyName}
                onChange={set('keyName')}
                helperText="EC2 key pair CÓ THẬT trên AWS (VD: techshop-key)"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Status"
                select
                fullWidth
                value={form.status}
                onChange={set('status')}
              >
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="archived">Archived</MenuItem>
              </TextField>
            </Grid>

            <Grid item xs={12}>
              <TextField
                label="GitOps Repo URL"
                fullWidth
                value={form.repoUrl}
                onChange={set('repoUrl')}
                helperText="Repo chứa helm/_base + argocd/apps — ArgoCD clone từ đây. Dùng làm repoURL trong argocd/apps/<slug>-<env>.yaml"
              />
            </Grid>

            {/* ── Cụm kubeadm: số node + node nào làm master ── */}
            <Grid item xs={12}>
              <Typography variant="subtitle1" gutterBottom style={{ marginTop: 8 }}>
                Kubernetes Cluster — Nodes
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Số node (tổng)"
                    select
                    fullWidth
                    value={form.nodeCount}
                    onChange={e => {
                      const n = Number(e.target.value);
                      setForm(f => ({
                        ...f,
                        nodeCount: n,
                        // Nếu master index vượt số node → tự về 0
                        masterNodeIndex: f.masterNodeIndex >= n ? 0 : f.masterNodeIndex,
                      }));
                    }}
                    helperText="1 master + N worker (kubeadm)"
                  >
                    {NODE_OPTIONS.map(n => (
                      <MenuItem key={n} value={n}>
                        {n} node
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Node nào là Master"
                    select
                    fullWidth
                    value={form.masterNodeIndex}
                    onChange={e => setForm(f => ({ ...f, masterNodeIndex: Number(e.target.value) }))}
                    helperText="Master ở public subnet (có public IP — kubeadm init + NLB upstream)"
                  >
                    {Array.from({ length: form.nodeCount }, (_, i) => (
                      <MenuItem key={i} value={i}>
                        Node {i} {i === 0 ? '(mặc định)' : ''}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Loại máy (Instance Type)"
                    select
                    fullWidth
                    value={form.instanceType}
                    onChange={e => setForm(f => ({ ...f, instanceType: String(e.target.value) }))}
                    helperText="EC2 cho master + worker (t3.small = 2 vCPU/2GB)"
                  >
                    {INSTANCE_TYPES.map(t => (
                      <MenuItem key={t} value={t}>
                        {t}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid item xs={12}>
                  <Chip
                    size="small"
                    color="primary"
                    variant="outlined"
                    label={`Master: node ${form.masterNodeIndex} · Worker: ${form.nodeCount - 1} node${form.nodeCount - 1 > 0 ? ` (node ${Array.from({ length: form.nodeCount }, (_, i) => i).filter(i => i !== form.masterNodeIndex).join(', ')})` : ''} · Máy: ${form.instanceType}`}
                  />
                </Grid>
              </Grid>
            </Grid>

            {/* ── Jenkins Pipeline Defaults — params hiển thị sẵn trên Jenkins UI ── */}
            <Grid item xs={12}>
              <Typography variant="subtitle1" gutterBottom style={{ marginTop: 8 }}>
                Jenkins Pipeline — Default Parameters
              </Typography>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                Những giá trị này sẽ là default của job <b>{form.slug || '<slug>'}-ci</b> trên Jenkins (có thể đổi lại khi build).
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="App Repo (APP_REPO)"
                    fullWidth
                    value={form.appRepo}
                    onChange={e => setForm(f => ({ ...f, appRepo: e.target.value }))}
                    placeholder={`https://github.com/vinh25042005/${form.slug || 'myapp'}.git`}
                    helperText="Repo mã nguồn app để build"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Registry Base (REGISTRY_BASE)"
                    fullWidth
                    value={form.registryBase}
                    onChange={e => setForm(f => ({ ...f, registryBase: e.target.value }))}
                    helperText="VD: docker.io/vinh2504"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Image Repo Prefix (IMAGE_REPO_PREFIX)"
                    fullWidth
                    value={form.imageRepoPrefix}
                    onChange={e => setForm(f => ({ ...f, imageRepoPrefix: e.target.value }))}
                    placeholder={form.slug || 'myapp'}
                    helperText="Image → &lt;prefix&gt;-backend / &lt;prefix&gt;-frontend"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Vault EIP (VAULT_EIP)"
                    fullWidth
                    value={form.vaultEip}
                    onChange={e => setForm(f => ({ ...f, vaultEip: e.target.value }))}
                    helperText="Vault VM IP — VAULT_ADDR=https://&lt;EIP&gt;:8200"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Deploy Branch (DEPLOY_BRANCH)"
                    fullWidth
                    value={form.deployBranch}
                    onChange={e => setForm(f => ({ ...f, deployBranch: e.target.value }))}
                    helperText="Branch deploy-web ArgoCD đang track"
                  />
                </Grid>
              </Grid>
            </Grid>

            {/* ── Jenkins Instance: chọn sẵn HOẶC tạo mới ── */}
            <Grid item xs={12}>
              <Typography variant="subtitle1" gutterBottom>
                Jenkins Instance
              </Typography>
                  {!jenkinsLoaded ? (
                    <CircularProgress size={20} />
                  ) : (
                    <Grid container spacing={1}>
                      <Grid item xs={showNewJenkins ? 7 : 12}>
                        <TextField
                          select
                          label="Chọn Jenkins có sẵn"
                          fullWidth
                          value={form.jenkinsInstance}
                          onChange={set('jenkinsInstance')}
                          disabled={showNewJenkins}
                        >
                          {jenkinsList.length === 0 && (
                            <MenuItem value="">(chưa có — tạo mới)</MenuItem>
                          )}
                          {jenkinsList.map(j => (
                            <MenuItem key={j.name} value={j.name}>
                              {j.name} ({j.url})
                            </MenuItem>
                          ))}
                        </TextField>
                      </Grid>
                      <Grid item xs={5}>
                        <Button
                          variant="outlined"
                          color={showNewJenkins ? 'secondary' : 'primary'}
                          onClick={() => setShowNewJenkins(v => !v)}
                        >
                          {showNewJenkins ? 'Hủy tạo mới' : '+ Create New'}
                        </Button>
                      </Grid>
                    </Grid>
                  )}

              {showNewJenkins && (
                <Box mt={1} p={2} style={{ background: '#f5f5f5', borderRadius: 8 }}>
                  <Grid container spacing={1}>
                    <Grid item xs={6}>
                      <TextField
                        label="Jenkins Name"
                        fullWidth
                        value={newJenkinsName}
                        onChange={e => setNewJenkinsName(e.target.value)}
                        placeholder="VD: Jenkins Client JITS"
                      />
                    </Grid>
                    <Grid item xs={6}>
                      <TextField
                        label="Jenkins URL"
                        fullWidth
                        value={newJenkinsUrl}
                        onChange={e => setNewJenkinsUrl(e.target.value)}
                        placeholder="VD: https://jenkins.example.com"
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <Button
                        variant="contained"
                        color="primary"
                        onClick={handleCreateJenkins}
                      >
                        Lưu Jenkins
                      </Button>
                    </Grid>
                  </Grid>
                </Box>
              )}
            </Grid>

          </Grid>
          )}

          {step === 1 && (
            <>
              <Typography variant="subtitle1" gutterBottom>
                Environments — mỗi env sẽ là một cluster riêng
              </Typography>
              <Grid container spacing={2}>
                {ENV_OPTIONS.map(e => (
                  <Grid item key={e}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={envs.includes(e)}
                          onChange={() => toggle(envs, e, setEnvs)}
                        />
                      }
                      label={e.toUpperCase()}
                    />
                  </Grid>
                ))}
              </Grid>

              <Divider style={{ margin: '20px 0' }} />

              <Typography variant="subtitle1" gutterBottom>
                Services
              </Typography>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                Chọn các component sẽ deploy lên cluster.
              </Typography>
              <Grid container spacing={2}>
                {SERVICE_OPTIONS.map(s => (
                  <Grid item xs={12} sm={6} md={4} key={s}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={services.includes(s)}
                          onChange={() => toggle(services, s, setServices)}
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="body1" style={{ textTransform: 'capitalize' }}>
                            {s}
                          </Typography>
                          {s === 'rancher' && (
                            <Typography variant="caption" color="textSecondary">
                              EC2 riêng chạy Rancher Server — quản lý cluster (ngoài cụm K8s)
                            </Typography>
                          )}
                        </Box>
                      }
                    />
                  </Grid>
                ))}
              </Grid>
            </>
          )}

          {step === 2 && (
            <>
              <Typography variant="subtitle1" gutterBottom>
                Integration Profiles
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
                  <TextField
                    label="Registry URL"
                    fullWidth
                    value={registry}
                    onChange={e => setRegistry(e.target.value)}
                    helperText="Docker registry user/org"
                  />
                </Grid>
              </Grid>

              <Divider style={{ margin: '20px 0' }} />

              <Typography variant="subtitle1" gutterBottom>
                Review
              </Typography>
              <Box>
                <Chip label={`Project: ${form.name || '—'}`} style={{ marginRight: 8, marginBottom: 8 }} />
                <Chip label={`Slug: ${form.slug || '—'}`} style={{ marginRight: 8 }} />
                <Chip label={`Envs: ${envs.join(', ')}`} style={{ marginRight: 8 }} />
                <Chip label={`Services: ${services.join(', ')}`} style={{ marginRight: 8 }} />
                <Chip label={`Key: ${form.keyName}`} />
                <Chip label={`Nodes: ${form.nodeCount} (master node ${form.masterNodeIndex}) · ${form.instanceType}`} style={{ marginRight: 8 }} />
              </Box>
              <Box mt={1}>
                <Chip label={`GitOps Repo: ${form.repoUrl || DEFAULT_REPO_URL}`} />
              </Box>
              <Box mt={1}>
                <Chip label={`APP_REPO: ${form.appRepo || form.slug || '—'}`} style={{ marginRight: 8 }} />
                <Chip label={`REGISTRY_BASE: ${form.registryBase}`} style={{ marginRight: 8 }} />
                <Chip label={`IMAGE_PREFIX: ${form.imageRepoPrefix || form.slug || '—'}`} style={{ marginRight: 8 }} />
                <Chip label={`VAULT_EIP: ${form.vaultEip}`} style={{ marginRight: 8 }} />
                <Chip label={`DEPLOY_BRANCH: ${form.deployBranch}`} />
              </Box>
            </>
          )}

          <Box display="flex" justifyContent="flex-end" mt={3} pb={1}>
            <Button
              onClick={() => setStep(s => Math.max(0, s - 1))}
              disabled={step === 0 || submitting}
              style={{ marginRight: 8 }}
            >
              Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button
                variant="contained"
                color="primary"
                onClick={() => setStep(s => s + 1)}
                disabled={!canNext()}
              >
                Next
              </Button>
            ) : (
              <Button
                variant="contained"
                color="primary"
                size="large"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? 'Đang tạo...' : 'Create Project'}
              </Button>
            )}
          </Box>
        </Paper>
      </Container>
    </>
  );
};
