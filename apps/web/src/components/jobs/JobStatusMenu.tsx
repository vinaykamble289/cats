import { useNavigate } from 'react-router-dom';
import { Copy, ExternalLink, MoreHorizontal, Pause, Pencil, Play, Trash2, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { humanize } from '@/lib/format';
import { useApiMutation } from '@/lib/hooks';
import type { Job, JobStatus } from '@/lib/types';
import { Button, Menu } from '@/components/ui';

/** "…" menu with lifecycle actions for a job. */
export function JobStatusMenu({ job, onDone, trigger }: { job: Job; onDone?: () => void; trigger?: React.ReactNode }) {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const setStatus = useApiMutation((status: JobStatus) => api.post<Job>(`/jobs/${job.id}/status`, { status }), {
    success: (j) => `Job is now ${humanize(j.status)}`,
    invalidate: [['jobs'], ['activity']],
    onSuccess: onDone,
  });
  const duplicate = useApiMutation(() => api.post<Job>(`/jobs/${job.id}/duplicate`), {
    success: 'Job duplicated as draft',
    invalidate: [['jobs']],
    onSuccess: (j) => navigate(`/jobs/${j.id}/edit`),
  });
  const remove = useApiMutation(() => api.delete(`/jobs/${job.id}`), {
    success: 'Draft deleted',
    invalidate: [['jobs']],
    onSuccess: () => navigate('/jobs'),
  });
  return (
    <Menu
      trigger={trigger ?? <Button size="sm" variant="ghost" icon={<MoreHorizontal className="size-4" />} aria-label="Job actions" />}
      items={[
        { label: 'Edit job', icon: <Pencil className="size-4" />, onClick: () => navigate(`/jobs/${job.id}/edit`) },
        (job.status === 'draft' || job.status === 'on_hold' || job.status === 'closed') && {
          label: job.status === 'draft' ? 'Publish' : 'Reopen',
          icon: <Play className="size-4" />,
          onClick: () => setStatus.mutate('open'),
        },
        job.status === 'open' && { label: 'Put on hold', icon: <Pause className="size-4" />, onClick: () => setStatus.mutate('on_hold') },
        job.status === 'open' && { label: 'View career page', icon: <ExternalLink className="size-4" />, onClick: () => window.open(`/careers/${job.slug}`, '_blank') },
        { label: 'Duplicate', icon: <Copy className="size-4" />, onClick: () => duplicate.mutate() },
        job.status !== 'closed' && job.status !== 'filled' && { label: 'Close job', icon: <XCircle className="size-4" />, danger: true, onClick: () => setStatus.mutate('closed') },
        job.status === 'draft' && hasRole('admin') && { label: 'Delete draft', icon: <Trash2 className="size-4" />, danger: true, onClick: () => confirm('Delete this draft job?') && remove.mutate() },
      ]}
    />
  );
}
