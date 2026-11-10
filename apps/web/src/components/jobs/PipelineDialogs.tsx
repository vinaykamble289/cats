import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApiMutation, useJobs } from '@/lib/hooks';
import type { ApplicationStage } from '@/lib/types';
import { Button, Checkbox, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { UserMultiSelect } from './UserMultiSelect';
import { STAGES, STAGE_LABEL } from '@/lib/format';

const INVALIDATE = [['applications'], ['candidates'], ['reviews'], ['activity']];

/** Assign resumes to reviewers. */
export function ReviewRequestDialog({ open, onClose, applicationIds, defaultReviewerIds = [], onDone }: { open: boolean; onClose: () => void; applicationIds: string[]; defaultReviewerIds?: string[]; onDone?: () => void }) {
  const [reviewers, setReviewers] = useState<string[]>(defaultReviewerIds);
  const [dueAt, setDueAt] = useState('');
  useEffect(() => {
    if (open) {
      setReviewers(defaultReviewerIds);
      setDueAt('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const m = useApiMutation(
    () => api.post<{ created: number }>('/reviews/request', { applicationIds, reviewerIds: reviewers, dueAt: dueAt ? new Date(dueAt).toISOString() : undefined }),
    {
      success: (r) => `${r.created} review request(s) sent`,
      invalidate: INVALIDATE,
      onSuccess: () => {
        onClose();
        onDone?.();
      },
    },
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send for resume review"
      description={`${applicationIds.length} candidate(s) · reviewers get one email with their queue`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!reviewers.length} loading={m.isPending} onClick={() => m.mutate()}>
            Request review
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Reviewers" required>
          <UserMultiSelect value={reviewers} onChange={setReviewers} />
        </Field>
        <Field label="Due by (optional)">
          <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/** Reject one or many applications, optionally emailing the candidates. */
export function RejectDialog({ open, onClose, applicationIds, onDone }: { open: boolean; onClose: () => void; applicationIds: string[]; onDone?: () => void }) {
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  useEffect(() => {
    if (open) {
      setReason('');
      setNotify(true);
    }
  }, [open]);
  const m = useApiMutation(
    () =>
      applicationIds.length === 1
        ? api.post(`/applications/${applicationIds[0]}/stage`, { status: 'rejected', rejectionReason: reason || undefined, notifyCandidate: notify }).then(() => ({ updated: 1 }))
        : api.post<{ updated: number }>('/applications/bulk/stage', { applicationIds, status: 'rejected', rejectionReason: reason || undefined, notifyCandidate: notify }),
    {
      success: (r) => `${(r as { updated: number }).updated} candidate(s) rejected`,
      invalidate: INVALIDATE,
      onSuccess: () => {
        onClose();
        onDone?.();
      },
    },
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={`Reject ${applicationIds.length} candidate${applicationIds.length > 1 ? 's' : ''}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={m.isPending} onClick={() => m.mutate()}>
            Reject
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Reason (internal)">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Not enough backend experience" />
        </Field>
        <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)} label="Send a polite rejection email to the candidate" />
      </div>
    </Modal>
  );
}

/** Move one or many applications to a stage. */
export function MoveStageDialog({ open, onClose, applicationIds, onDone }: { open: boolean; onClose: () => void; applicationIds: string[]; onDone?: () => void }) {
  const [stage, setStage] = useState<ApplicationStage>('shortlisted');
  const [note, setNote] = useState('');
  const m = useApiMutation(() => api.post<{ updated: number }>('/applications/bulk/stage', { applicationIds, stage, status: 'active', note: note || undefined }), {
    success: (r) => `${r.updated} candidate(s) moved to ${STAGE_LABEL[stage]}`,
    invalidate: INVALIDATE,
    onSuccess: () => {
      onClose();
      onDone?.();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Move to stage"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={m.isPending} onClick={() => m.mutate()}>
            Move
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Stage">
          <Select value={stage} onChange={(e) => setStage(e.target.value as ApplicationStage)}>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/** Add an existing candidate to another job. */
export function AddToJobDialog({ open, onClose, candidateId, excludeJobIds = [] }: { open: boolean; onClose: () => void; candidateId: string; excludeJobIds?: string[] }) {
  const { data: jobs } = useJobs();
  const [jobId, setJobId] = useState('');
  const m = useApiMutation(() => api.post('/applications', { candidateId, jobId }), {
    success: 'Added to job — AI match running',
    invalidate: [['candidates'], ['applications']],
    onSuccess: () => {
      setJobId('');
      onClose();
    },
  });
  const options = (jobs ?? []).filter((j) => !excludeJobIds.includes(j.id) && j.status !== 'closed' && j.status !== 'filled');
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Add to job"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!jobId} loading={m.isPending} onClick={() => m.mutate()}>
            Add
          </Button>
        </>
      }
    >
      <Field label="Job">
        <Select value={jobId} onChange={(e) => setJobId(e.target.value)}>
          <option value="">Select a job…</option>
          {options.map((j) => (
            <option key={j.id} value={j.id}>
              {j.title} ({j.code})
            </option>
          ))}
        </Select>
      </Field>
    </Modal>
  );
}
