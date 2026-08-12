import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  CircularProgress,
  Box,
} from '@material-ui/core';
import { useProjectsApi } from '../../api';

interface Props {
  open: boolean;
  projectId: string;
  projectName: string;
  env: string;
  mode?: 'apply' | 'destroy' | 'init' | 'plan'; // apply (mặc định) / destroy / init / plan
  // view: chỉ XEM log của job đã có (initialJobId) — không start apply/destroy mới.
  // Dùng khi mở lại log đang chạy sau khi lỡ đóng dialog.
  initialJobId?: string;
  onClose: () => void;
}

const MODE_LABEL: Record<string, string> = {
  apply: 'apply',
  destroy: 'destroy',
  init: 'init',
  plan: 'plan',
};

// Modal hiện log terraform apply/destroy real-time (poll job theo jobId mỗi 2s)
export const ApplyLogDialog = ({
  open,
  projectId,
  projectName,
  env,
  mode = 'apply',
  initialJobId,
  onClose,
}: Props) => {
  const api = useProjectsApi();
  const [jobId, setJobId] = useState<string>('');
  const [status, setStatus] = useState<'starting' | 'running' | 'success' | 'error'>('starting');
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Bắt đầu apply/destroy khi mở dialog (KHÔNG áp dụng ở chế độ view)
  useEffect(() => {
    if (!open) return;
    setLogs([]);
    setStatus('starting');
    setError('');
    setJobId('');
    // view mode: bám theo job đã có, không start mới
    if (initialJobId) {
      setJobId(initialJobId);
      setStatus('running');
      return;
    }
    const start =
      mode === 'destroy'
        ? api.destroyProject(projectId, env)
        : mode === 'init'
          ? api.initProject(projectId, env)
          : mode === 'plan'
            ? api.planProject(projectId, env)
            : api.applyProject(projectId, env);
    start
      .then(id => {
        setJobId(id);
        setStatus('running');
      })
      .catch(e => {
        setError(`Không bắt đầu được ${mode}: ${e.message}`);
        setStatus('error');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, env, mode, initialJobId]);

  // Poll log khi có jobId
  useEffect(() => {
    if (!open || !jobId) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const job = await api.getApplyJob(jobId);
        if (cancelled) return;
        setLogs(job.logs);
        if (job.status !== 'running') {
          setStatus(job.status);
          clearInterval(timer);
        }
      } catch (e: any) {
        if (cancelled) return;
        setError(`Lỗi đọc log: ${e.message}`);
        clearInterval(timer);
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, jobId]);

  // Auto-scroll xuống cuối log
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Terraform {MODE_LABEL[mode] ?? 'apply'.toUpperCase()} — {projectName} ({env})
        {status === 'running' && (
          <Box component="span" ml={2} style={{ verticalAlign: 'middle' }}>
            <CircularProgress size={18} />
          </Box>
        )}
        {status === 'success' && (
          <Box component="span" ml={2} style={{ verticalAlign: 'middle' }}>
            <Typography component="span" style={{ color: '#2e7d32', fontWeight: 600 }}>
              ✓ Đã xong
            </Typography>
          </Box>
        )}
        {status === 'error' && (
          <Box component="span" ml={2} style={{ verticalAlign: 'middle' }}>
            <Typography component="span" style={{ color: '#d32f2f', fontWeight: 600 }}>
              ✗ Thất bại
            </Typography>
          </Box>
        )}
      </DialogTitle>
      <DialogContent dividers>
        {error && (
          <Box mb={2} p={2} style={{ background: '#fdecea', borderRadius: 4 }}>
            <Typography color="error">{error}</Typography>
          </Box>
        )}
        <Box
          p={2}
          style={{
            background: '#0d1117',
            color: '#c9d1d9',
            borderRadius: 8,
            fontFamily: 'monospace',
            fontSize: 12,
            maxHeight: 420,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {logs.length === 0 && status !== 'error' ? (
            <Typography style={{ color: '#8b949e' }}>
              Đang chờ terraform {MODE_LABEL[mode] ?? 'apply'}...
            </Typography>
          ) : (
            logs.join('')
          )}
          <div ref={bottomRef} />
        </Box>
        {status === 'success' && (
          <Box mt={2}>
            <Typography color="primary" style={{ fontWeight: 600 }}>
              ✅ Terraform {MODE_LABEL[mode] ?? 'apply'} thành công!
            </Typography>
          </Box>
        )}
        {status === 'error' && (
          <Box mt={2}>
            <Typography color="error" style={{ fontWeight: 600 }}>
              ❌ Terraform {MODE_LABEL[mode] ?? 'apply'} thất bại (xem log ở trên)
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="primary">
          Đóng
        </Button>
      </DialogActions>
    </Dialog>
  );
};
