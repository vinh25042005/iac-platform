import { useEffect, useState } from 'react';
import {
  Button,
  Paper,
  Typography,
  Grid,
  Box,
  IconButton,
  Chip,
} from '@material-ui/core';
import { Header, Container } from '@backstage/ui';
import { useProjectsApi, Project } from '../../api';
import { EnvConfigWizard } from '../EnvConfigWizard/EnvConfigWizard';

const DEFAULT_ENVS = ['dev', 'stg', 'prd'];

interface JobLite {
  id: string;
  status: string;
  project: string;
  env: string;
  mode: string;
}

/**
 * ProjectDetailsPage — trang chi tiết 1 project.
 *  - Project Metadata: thông tin cơ bản sync từ database.
 *  - Deployment Environments: thẻ dev/stg/prd, mỗi thẻ có nút Configure Wizard
 *    → mở EnvConfigWizard (SETUP/ENV VARS/INFRA/...).
 */
export const ProjectDetailsPage = ({
  project,
  onBack,
}: {
  project: Project;
  onBack: () => void;
}) => {
  const api = useProjectsApi();
  const [jobs, setJobs] = useState<JobLite[]>([]);
  const [configureTarget, setConfigureTarget] = useState<string | null>(null);
  // Chỉ hiện các env đã chọn lúc tạo project
  const envs = project.envs?.length ? project.envs : DEFAULT_ENVS;

  // Lấy trạng thái job apply/destroy đang nhớ để suy ra trạng thái từng env
  useEffect(() => {
    api
      .listApplyJobs()
      .then(all => setJobs(all))
      .catch(() => {
        /* im lặng */
      });
  }, [api]);

  function envStatus(env: string): { color: string; label: string } {
    const list = jobs.filter(j => j.project === project.slug && j.env === env);
    if (list.some(j => j.status === 'running')) {
      return { color: '#f9a825', label: 'Running' };
    }
    if (list.some(j => j.status === 'success')) {
      return { color: '#2e7d32', label: 'Provisioned' };
    }
    return { color: '#bdbdbd', label: 'Not applied' };
  }

  if (configureTarget) {
    return (
      <EnvConfigWizard
        project={project}
        env={configureTarget}
        onBack={() => setConfigureTarget(null)}
      />
    );
  }

  return (
    <>
      <Header
        title="Project Details"
        description="Basic information synchronized from database"
      />
      <Container>
        <Box mb={2}>
          <Button onClick={onBack} size="small">
            ← Back to Projects
          </Button>
        </Box>

        {/* ── Project Metadata ── */}
        <Paper style={{ padding: 24, marginBottom: 24 }}>
          <Typography variant="h6" gutterBottom>
            Project Metadata
          </Typography>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6} md={3}>
              <Typography variant="body2" color="textSecondary">
                Project Name
              </Typography>
              <Typography>{project.name}</Typography>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Typography variant="body2" color="textSecondary">
                Project Owner
              </Typography>
              <Typography>{project.owner}</Typography>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Typography variant="body2" color="textSecondary">
                Status
              </Typography>
              <Chip
                size="small"
                label={project.status}
                color={project.status === 'active' ? 'primary' : 'default'}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Typography variant="body2" color="textSecondary">
                Namespace
              </Typography>
              <Typography>{project.slug}</Typography>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Typography variant="body2" color="textSecondary">
                AWS Key Pair
              </Typography>
              <Typography>{project.keyName}</Typography>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Typography variant="body2" color="textSecondary">
                Jenkins Instance
              </Typography>
              <Typography>{project.jenkinsInstance || '—'}</Typography>
            </Grid>
            <Grid item xs={12}>
              <Typography variant="body2" color="textSecondary">
                GitOps Repo
              </Typography>
              <Typography style={{ wordBreak: 'break-all' }}>
                {project.repoUrl || '—'}
              </Typography>
            </Grid>
            <Grid item xs={12}>
              <Typography variant="body2" color="textSecondary">
                Cluster Nodes
              </Typography>
              <Typography>
                {project.nodeCount} node (master: node {project.masterNodeIndex}, worker:{' '}
                {(project.nodeCount || 1) - 1}) · máy {project.instanceType || 't3.small'}
              </Typography>
            </Grid>
            <Grid item xs={12}>
              <Typography variant="body2" color="textSecondary">
                Jenkins Defaults
              </Typography>
              <Typography>
                APP_REPO: {project.appRepo || '—'} · REGISTRY: {project.registryBase || '—'} ·
                IMAGE_PREFIX: {project.imageRepoPrefix || '—'} · VAULT_EIP:{' '}
                {project.vaultEip || '—'} · DEPLOY_BRANCH: {project.deployBranch || '—'}
              </Typography>
            </Grid>
          </Grid>
        </Paper>

        {/* ── Deployment Environments ── */}
        <Typography variant="h6" gutterBottom>
          Deployment Environments
        </Typography>
        <Typography variant="body2" color="textSecondary" paragraph>
          Configure infrastructure and CI/CD parameters for each environment.
        </Typography>
        <Grid container spacing={2}>
          {envs.map(env => {
            const st = envStatus(env);
            return (
              <Grid item xs={12} sm={6} md={4} key={env}>
                <Paper style={{ padding: 16, borderTop: `4px solid ${st.color}`, height: '100%' }}>
                  <Box
                    display="flex"
                    alignItems="center"
                    justifyContent="space-between"
                    mb={1}
                  >
                    <Box display="flex" alignItems="center">
                      <Box
                        width={10}
                        height={10}
                        borderRadius="50%"
                        bgcolor={st.color}
                        mr={1}
                      />
                      <Typography variant="h6">{env.toUpperCase()} Config</Typography>
                    </Box>
                    <Box>
                      <IconButton size="small" onClick={() => {}}>
                        <Typography variant="body2">⚙️</Typography>
                      </IconButton>
                      <IconButton size="small" onClick={() => {}}>
                        <Typography variant="body2">🗑</Typography>
                      </IconButton>
                    </Box>
                  </Box>
                  <Typography variant="body2" color="textSecondary">
                    Namespace: {project.slug}-{env}
                  </Typography>
                  <Box mt={1}>
                    <Chip
                      size="small"
                      label={st.label}
                      style={{ background: st.color, color: '#fff' }}
                    />
                  </Box>
                  <Box mt={2}>
                    <Button
                      fullWidth
                      variant="contained"
                      color="primary"
                      onClick={() => setConfigureTarget(env)}
                    >
                      Config
                    </Button>
                  </Box>
                  <Box mt={1}>
                    <Button fullWidth size="small" variant="text" onClick={() => {}}>
                      View Pipeline
                    </Button>
                  </Box>
                </Paper>
              </Grid>
            );
          })}
        </Grid>
      </Container>
    </>
  );
};
