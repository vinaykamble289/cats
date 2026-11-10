import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check, ClipboardCheck, FileSearch, Handshake, MoreHorizontal, Pause, PlayCircle, RotateCcw, Star, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { DECISION_LABEL, fmtDate, fmtDateTime, fromNow, STAGES, STAGE_LABEL, STATUS_LABEL, toneFor } from '@/lib/format';
import { useApiMutation, useJobMap, useUserMap } from '@/lib/hooks';
import type { Application, ApplicationDetail, ApplicationStage } from '@/lib/types';
import { CreateOfferDialog, SendTestDialog, StartInterviewsDialog } from '@/components/actions';
import { StatusBadge } from '@/components/StatusBadge';
import { Badge, Button, Card, Menu, Select, Spinner, Stars, cx } from '@/components/ui';
import { RejectDialog, ReviewRequestDialog } from '@/components/jobs/PipelineDialogs';
import { AiMatchCard } from './AiMatchCard';

export function StageStepper({ stage, status }: { stage: ApplicationStage; status: Application['status'] }) {
  const idx = STAGES.indexOf(stage);
  const inactive = status === 'rejected' || status === 'withdrawn';
  return (
    <div className="scroll-thin flex items-center overflow-x-auto pb-1">
      {STAGES.map((s, i) => {
        const done = i < idx || (status === 'hired' && i <= idx);
        const current = i === idx && status !== 'hired';
        return (
          <div key={s} className="flex shrink-0 items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={cx(
                  'flex size-6 items-center justify-center rounded-full text-[10px] font-semibold ring-2 ring-white',
                  done ? 'bg-emerald-500 text-white' : current ? (inactive ? 'bg-red-500 text-white' : 'bg-brand-600 text-white') : 'bg-zinc-100 text-zinc-400',
                )}
              >
                {done ? <Check className="size-3.5" /> : current && inactive ? <XCircle className="size-3.5" /> : i + 1}
              </div>
              <span className={cx('text-[10px] whitespace-nowrap', current ? 'font-semibold text-zinc-900' : 'text-zinc-500')}>{STAGE_LABEL[s]}</span>
            </div>
            {i < STAGES.length - 1 && <div className={cx('mx-1 mb-4 h-0.5 w-6', i < idx ? 'bg-emerald-400' : 'bg-zinc-200')} />}
          </div>
        );
      })}
    </div>
  );
}

type Dialog = 'test' | 'interviews' | 'offer' | 'reject' | 'review' | null;

/** One application of a candidate: stepper, AI match, reviews, history and HR actions. */
export function ApplicationPanel({ app, candidateName, isHR }: { app: Application; candidateName: string; isHR: boolean }) {
  const jobs = useJobMap();
  const users = useUserMap();
  const job = jobs.get(app.jobId);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [showHistory, setShowHistory] = useState(false);
  const detail = useQuery({ queryKey: ['applications', app.id], queryFn: () => api.get<ApplicationDetail>(`/applications/${app.id}`) });

  const invalidate = [['applications'], ['candidates'], ['activity']];
  const move = useApiMutation((body: { stage?: ApplicationStage; status?: Application['status']; note?: string }) => api.post(`/applications/${app.id}/stage`, body), {
    success: 'Application updated',
    invalidate,
  });

  const reviews = (detail.data?.reviews ?? []).filter((r) => r.status !== 'cancelled');
  const active = app.status === 'active' || app.status === 'on_hold';

  return (
    <Card className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/jobs/${app.jobId}`} className="text-base font-semibold text-zinc-900 hover:text-brand-700">
            {job?.title ?? 'Job'}
          </Link>
          <p className="mt-0.5 text-xs text-zinc-500">
            {job?.code} · Applied {fmtDate(app.appliedAt)} · in stage {fromNow(app.stageChangedAt).replace(' ago', '')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge value={app.status} label={STATUS_LABEL[app.status]} />
          {isHR && active && (
            <>
              <Select value={app.stage} onChange={(e) => move.mutate({ stage: e.target.value as ApplicationStage, status: 'active' })} className="h-8 w-40 text-xs">
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </option>
                ))}
              </Select>
              <Menu
                trigger={<Button size="sm" variant="outline" icon={<MoreHorizontal className="size-4" />}>Actions</Button>}
                items={[
                  { label: 'Send for review', icon: <FileSearch className="size-4" />, onClick: () => setDialog('review') },
                  { label: 'Shortlist', icon: <Star className="size-4" />, onClick: () => move.mutate({ stage: 'shortlisted', status: 'active' }) },
                  { label: 'Send assessment', icon: <ClipboardCheck className="size-4" />, onClick: () => setDialog('test') },
                  { label: 'Start interview series', icon: <PlayCircle className="size-4" />, onClick: () => setDialog('interviews') },
                  { label: 'Create offer', icon: <Handshake className="size-4" />, onClick: () => setDialog('offer') },
                  app.status === 'active'
                    ? { label: 'Put on hold', icon: <Pause className="size-4" />, onClick: () => move.mutate({ status: 'on_hold' }) }
                    : { label: 'Resume (reactivate)', icon: <RotateCcw className="size-4" />, onClick: () => move.mutate({ status: 'active' }) },
                  { label: 'Reject', icon: <XCircle className="size-4" />, danger: true, onClick: () => setDialog('reject') },
                ]}
              />
            </>
          )}
          {isHR && !active && app.status !== 'hired' && (
            <Button size="sm" variant="outline" icon={<RotateCcw className="size-4" />} loading={move.isPending} onClick={() => move.mutate({ status: 'active' })}>
              Reactivate
            </Button>
          )}
        </div>
      </div>

      <StageStepper stage={app.stage} status={app.status} />
      {app.rejectionReason && app.status === 'rejected' && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Rejected: {app.rejectionReason}</p>}

      <AiMatchCard application={app} canRematch={isHR} />

      <div>
        <p className="mb-2 text-[13px] font-semibold text-zinc-700">Resume reviews</p>
        {detail.isLoading ? (
          <Spinner className="size-4" />
        ) : !reviews.length ? (
          <p className="text-sm text-zinc-400">No reviews requested yet.</p>
        ) : (
          <div className="space-y-2">
            {reviews.map((r) => (
              <div key={r.id} className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-zinc-800">{users.get(r.reviewerId)?.fullName ?? 'Reviewer'}</span>
                  {r.status === 'completed' && r.decision ? <Badge tone={toneFor(r.decision)}>{DECISION_LABEL[r.decision]}</Badge> : <Badge tone="amber">Pending</Badge>}
                  {r.rating && <Stars value={r.rating} size="sm" />}
                  <span className="ml-auto text-xs text-zinc-400">{r.submittedAt ? fmtDateTime(r.submittedAt) : `Requested ${fromNow(r.requestedAt)}`}</span>
                </div>
                {r.comments && <p className="mt-1.5 text-sm text-zinc-600">{r.comments}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {detail.data?.stageHistory?.length ? (
        <div>
          <button onClick={() => setShowHistory((s) => !s)} className="cursor-pointer text-xs font-medium text-brand-600 hover:underline">
            {showHistory ? 'Hide' : 'Show'} stage history ({detail.data.stageHistory.length})
          </button>
          {showHistory && (
            <ol className="mt-3 space-y-2 border-l-2 border-zinc-100 pl-4">
              {detail.data.stageHistory.map((h) => (
                <li key={h.id} className="text-sm">
                  <span className="text-zinc-800">
                    {h.toStatus !== h.fromStatus && h.toStatus !== 'active' ? STATUS_LABEL[h.toStatus] : STAGE_LABEL[h.toStage]}
                  </span>
                  {h.note && <span className="text-zinc-500"> — {h.note}</span>}
                  <span className="block text-xs text-zinc-400">
                    {fmtDateTime(h.changedAt)}
                    {h.changedBy && users.get(h.changedBy) ? ` · ${users.get(h.changedBy)!.fullName}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}

      {isHR && (
        <>
          <ReviewRequestDialog open={dialog === 'review'} onClose={() => setDialog(null)} applicationIds={[app.id]} defaultReviewerIds={job?.reviewerIds} />
          <RejectDialog open={dialog === 'reject'} onClose={() => setDialog(null)} applicationIds={[app.id]} />
          <SendTestDialog open={dialog === 'test'} onClose={() => setDialog(null)} applicationIds={[app.id]} jobId={app.jobId} />
          <StartInterviewsDialog open={dialog === 'interviews'} onClose={() => setDialog(null)} applicationIds={[app.id]} jobId={app.jobId} />
          <CreateOfferDialog open={dialog === 'offer'} onClose={() => setDialog(null)} applicationId={app.id} candidateName={candidateName} jobId={app.jobId} />
        </>
      )}
    </Card>
  );
}
