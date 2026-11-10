import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, PlayCircle, UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/hooks';
import { ROUND_KIND_LABEL } from '@/lib/format';
import type { Job } from '@/lib/types';
import { Badge, Button, Modal, Spinner } from '../ui';

export interface StartInterviewsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Applications to start the interview series for (bulk supported) */
  applicationIds: string[];
  /** Used to show the job's interview plan */
  jobId?: string;
  onDone?: () => void;
}

interface SeriesResult {
  created: number;
  skipped: number;
  errors: { applicationId: string; error: string }[];
}

export function StartInterviewsDialog({ open, onClose, applicationIds, jobId, onDone }: StartInterviewsDialogProps) {
  const [result, setResult] = useState<SeriesResult | null>(null);
  useEffect(() => {
    if (open) setResult(null);
  }, [open]);

  const { data: job, isLoading } = useQuery({
    queryKey: ['jobs', jobId],
    queryFn: () => api.get<Job>(`/jobs/${jobId}`),
    enabled: open && !!jobId,
  });

  const start = useApiMutation((ids: string[]) => api.post<SeriesResult>('/rounds/series', { applicationIds: ids }), {
    success: (r) => `Interview series started for ${r.created} candidate(s)`,
    invalidate: [['rounds'], ['applications']],
    onSuccess: (r) => {
      setResult(r);
      onDone?.();
    },
  });

  const plan = job?.interviewPlan ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Start interview series"
      description={`${applicationIds.length} candidate${applicationIds.length === 1 ? '' : 's'} will go through the job's interview plan`}
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={start.isPending} disabled={!applicationIds.length} onClick={() => start.mutate(applicationIds)} icon={<PlayCircle className="size-4" />}>
              Start interviews
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-2 text-sm">
          <p>
            <strong>{result.created}</strong> started, <strong>{result.skipped}</strong> skipped (already in progress).
          </p>
          {result.errors.map((e) => (
            <p key={e.applicationId} className="text-xs text-red-600">
              {e.error}
            </p>
          ))}
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-4">
          {plan.length ? (
            <ol className="space-y-2">
              {plan.map((r, i) => (
                <li key={r.id ?? i} className="flex items-center gap-3 rounded-lg border border-zinc-200 p-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-600">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-900">{r.name}</p>
                    <p className="text-xs text-zinc-500">
                      {r.durationMin} min{r.kind !== 'human' ? ` · ${r.questionCount} questions · pass ${r.passScore}` : ''}
                    </p>
                  </div>
                  <Badge tone={r.kind === 'human' ? 'blue' : 'violet'}>
                    {r.kind === 'human' ? <UserRound className="size-3" /> : <Bot className="size-3" />}
                    {ROUND_KIND_LABEL[r.kind]}
                  </Badge>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-zinc-500">The job's default interview plan will be used.</p>
          )}
          <p className="text-xs text-zinc-500">
            AI rounds are emailed to the candidate automatically and advance on pass. Live rounds wait for you to schedule them.
          </p>
        </div>
      )}
    </Modal>
  );
}
