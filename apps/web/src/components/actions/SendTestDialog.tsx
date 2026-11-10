import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/hooks';
import type { Paginated, Test } from '@/lib/types';
import { Badge, Button, EmptyState, Field, Input, Modal, Spinner, cx } from '../ui';

export interface SendTestDialogProps {
  open: boolean;
  onClose: () => void;
  /** Applications to invite (bulk supported) */
  applicationIds: string[];
  /** Used to preselect tests linked to this job */
  jobId?: string;
  onDone?: () => void;
}

interface InviteResult {
  created: number;
  skipped: number;
  errors: { applicationId: string; error: string }[];
}

export function SendTestDialog({ open, onClose, applicationIds, jobId, onDone }: SendTestDialogProps) {
  const [testId, setTestId] = useState<string>('');
  const [days, setDays] = useState(3);
  const [result, setResult] = useState<InviteResult | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['tests', 'active'],
    queryFn: () => api.get<Paginated<Test>>('/tests', { status: 'active' }),
    enabled: open,
  });

  const tests = useMemo(() => {
    const list = data?.data ?? [];
    return [...list].sort((a, b) => Number(b.jobId === jobId) - Number(a.jobId === jobId));
  }, [data, jobId]);

  useEffect(() => {
    if (open) {
      setResult(null);
      setTestId('');
    }
  }, [open]);
  useEffect(() => {
    if (!testId && tests.length) setTestId(tests[0].id);
  }, [tests, testId]);

  const send = useApiMutation((body: { testId: string; applicationIds: string[]; expiresInDays: number }) => api.post<InviteResult>('/invitations', body), {
    success: (r) => `${r.created} invitation(s) sent`,
    invalidate: [['invitations'], ['applications'], ['tests']],
    onSuccess: (r) => {
      setResult(r);
      onDone?.();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send assessment"
      description={`Invite ${applicationIds.length} candidate${applicationIds.length === 1 ? '' : 's'} to an online test`}
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={send.isPending}
              disabled={!testId || !applicationIds.length}
              onClick={() => send.mutate({ testId, applicationIds, expiresInDays: days })}
              icon={<ClipboardCheck className="size-4" />}
            >
              Send invitations
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-emerald-50 p-3 text-center">
              <p className="text-2xl font-semibold text-emerald-700">{result.created}</p>
              <p className="text-xs text-emerald-700">Sent</p>
            </div>
            <div className="rounded-lg bg-zinc-100 p-3 text-center">
              <p className="text-2xl font-semibold text-zinc-700">{result.skipped}</p>
              <p className="text-xs text-zinc-600">Skipped</p>
            </div>
            <div className="rounded-lg bg-red-50 p-3 text-center">
              <p className="text-2xl font-semibold text-red-700">{result.errors.length}</p>
              <p className="text-xs text-red-700">Failed</p>
            </div>
          </div>
          {result.errors.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-red-100 bg-red-50/50 p-3 text-xs text-red-700">
              {result.errors.map((e) => (
                <li key={e.applicationId}>{e.error}</li>
              ))}
            </ul>
          )}
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : !tests.length ? (
        <EmptyState title="No active tests" description="Create a test and set it to Active in Assessments first." />
      ) : (
        <div className="space-y-4">
          <Field label="Test">
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {tests.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTestId(t.id)}
                  className={cx(
                    'w-full cursor-pointer rounded-lg border p-3 text-left transition',
                    testId === t.id ? 'border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/20' : 'border-zinc-200 hover:border-zinc-300',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-zinc-900">{t.title}</span>
                    {jobId && t.jobId === jobId && <Badge tone="violet">This job</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {t.questionCount} questions · {t.durationMin} min · pass {t.passPercent}%{t.proctoringEnabled ? ' · proctored' : ''}
                  </p>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Link valid for (days)">
            <Input type="number" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value) || 3)} className="w-32" />
          </Field>
          <p className="text-xs text-zinc-500">Candidates receive an email with a secure link. Their pipeline stage moves to Assessment.</p>
        </div>
      )}
    </Modal>
  );
}
