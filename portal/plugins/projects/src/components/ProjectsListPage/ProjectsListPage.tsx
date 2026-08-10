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
} from '@material-ui/core';
import { Header, Container } from '@backstage/ui';
import { useProjectsApi, Project } from '../../api';
import { CreateProjectPage } from '../CreateProjectPage/CreateProjectPage';

export const ProjectsListPage = () => {
  const api = useProjectsApi();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

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

  useEffect(() => {
    load();
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

  if (showCreate) {
    return <CreateProjectPage onCreated={handleCreated} />;
  }

  function renderBody() {
    if (loading) {
      return (
        <TableRow>
          <TableCell colSpan={6} align="center">
            <CircularProgress size={24} />
          </TableCell>
        </TableRow>
      );
    }
    if (projects.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={6} align="center">
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
        <TableCell>{p.name}</TableCell>
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
      </TableRow>
    ));
  }

  return (
    <>
      <Header title="Projects" subtitle="Manage infrastructure projects across all environments" />
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
                <TableCell>Option</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>{renderBody()}</TableBody>
          </Table>
        </TableContainer>
      </Container>
    </>
  );
};
