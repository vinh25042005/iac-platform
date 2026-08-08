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
  Alert,
} from '@material-ui/core';
import { Header, Container } from '@backstage/ui';
import { useProjectsApi, JenkinsInstance } from '../api';

interface FormState {
  name: string;
  slug: string;
  owner: string;
  kickoffDate: string;
  jiraKey: string;
  jenkinsInstance: string;
  status: string;
}

const emptyForm: FormState = {
  name: '',
  slug: '',
  owner: '',
  kickoffDate: '',
  jiraKey: '',
  jenkinsInstance: '',
  status: 'active',
};

export const CreateProjectPage = ({ onCreated }: { onCreated?: () => void }) => {
  const api = useProjectsApi();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [jenkinsList, setJenkinsList] = useState<JenkinsInstance[]>([]);
  const [jenkinsLoaded, setJenkinsLoaded] = useState(false);
  const [showNewJenkins, setShowNewJenkins] = useState(false);
  const [newJenkinsName, setNewJenkinsName] = useState('');
  const [newJenkinsUrl, setNewJenkinsUrl] = useState('');
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

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

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

  async function handleSubmit() {
    setError('');
    if (!form.name.trim() || !form.slug.trim() || !form.owner.trim()) {
      setError('Vui lòng điền đủ: Project Name, Slug, Owner');
      return;
    }
    if (!form.jenkinsInstance) {
      setError('Chọn hoặc tạo mới Jenkins Instance');
      return;
    }
    setSubmitting(true);
    try {
      await api.createProject(form);
      setForm(emptyForm);
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
      <Header title="Create Project" subtitle="Tạo project mới trên iac-platform (giống CatalogHub)" />
      <Container>
        <Paper style={{ padding: 24, maxWidth: 860 }}>
          <Typography variant="h6" gutterBottom>
            Project Details — basic information synchronized from database
          </Typography>

          {error && (
            <Box mb={2}>
              <Alert severity="error">{error}</Alert>
            </Box>
          )}

          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Project Name"
                fullWidth
                value={form.name}
                onChange={set('name')}
                placeholder="VD: BNF Project"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Project ID / Code (Slug)"
                fullWidth
                value={form.slug}
                onChange={set('slug')}
                placeholder="VD: bnf — dùng cho namespace"
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                label="Project Owner"
                fullWidth
                value={form.owner}
                onChange={set('owner')}
                placeholder="VD: Bui Tien Thanh (Escanor)"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Kickoff Date"
                type="date"
                fullWidth
                value={form.kickoffDate}
                onChange={set('kickoffDate')}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                label="Jira Project Key"
                fullWidth
                value={form.jiraKey}
                onChange={set('jiraKey')}
                placeholder="VD: BNFDI6"
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

            <Grid item xs={12}>
              <Box display="flex" justifyContent="flex-end" mt={2}>
                <Button
                  variant="contained"
                  color="primary"
                  size="large"
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  {submitting ? 'Đang tạo...' : 'Create Project'}
                </Button>
              </Box>
            </Grid>
          </Grid>
        </Paper>
      </Container>
    </>
  );
};
