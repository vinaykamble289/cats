import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Bot, CalendarPlus, CheckCircle2, ExternalLink, MoreHorizontal, Send, ThumbsDown, ThumbsUp, UserRound, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useApiMutation, useUserMap, useUsers } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, RECOMMENDATION_LABEL, ROUND_KIND_LABEL } from '@/lib/format';
import type { Recommendation, RoundDetail as RoundDetailT } from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';
import { ProctoringPanel } from '@/components/assessments/ProctoringPanel';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DescriptionList,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Menu,
  Modal,
  PageHeader,
  PageLoader,
  ProgressBar,
  ScoreRing,
  Select,
  Stars,
  Textarea,
  cx,
} from '@/components/ui';

const RECS: Recommendation[] = ['strong_hire', 'hire', 'lean_hire', 'lean_no_hire', 'no_hire'];

/** ISO -> value for <input type="datetime-local"> in local time */
function toLocalInput(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 24 * 3600_000);
  if (!iso) d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ScheduleModal({ round, open, onClose }: { round: RoundDetailT; open: boolean; onClose: () => void }) {
  const { data: users } = useUsers();
  const [when, setWhen] = useState(toLocalInput(round.scheduledAt));
  const [duration, setDuration] = useState(round.durationMin);
  const [meetingUrl, setMeetingUrl] = useState(round.meetingUrl ?? '');
  const [panel, setPanel] = useState<string[]>(round.interviewerIds);
  const candidates = (users ?? []).filter((u) => u.isActive && u.role !== 'reviewer');
  const schedule = useApiMutation(
    () => api.post(`/rounds/${round.id}/schedule`, { scheduledAt: new Date(when).toISOString(), durationMin: duration, meetingUrl, interviewerIds: panel }),
    { success: 'Interview scheduled · invites sent', invalidate: [['rounds']], onSuccess: onClose },
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={round.scheduledAt ? 'Reschedule interview' : 'Schedule interview'}
      description={`${round.name} with ${round.candidateName}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={schedule.isPending}
            icon={<Send className="size-4" />}
            onClick={() => {
              if (!when || !meetingUrl.trim() || !panel.length) return toast.error('Time, meeting link and at least one interviewer are required');
              schedule.mutate();
            }}
          >
            Schedule & send invites
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_120px] gap-4">
          <Field label="Date & time" required>
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Field label="Duration (min)">
            <Input type="number" min={5} max={240} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
          </Field>
        </div>
        <Field label="Meeting link" required hint="Google Meet, Zoom or Teams URL">
          <Input value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} placeholder="https://meet.google.com/…" />
        </Field>
        <Field label="Interview panel" required>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 p-1">
            {candidates.map((u) => (
              <label key={u.id} className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-zinc-50">
                <input
                  type="checkbox"
                  className="size-4 accent-brand-600"
                  checked={panel.includes(u.id)}
                  onChange={(e) => setPanel(e.target.checked ? [...panel, u.id] : panel.filter((x) => x !== u.id))}
                />
                <Avatar name={u.fullName || u.email} size="xs" />
                <span className="flex-1 text-sm">{u.fullName || u.email}</span>
                <span className="text-xs text-zinc-400">{u.title ?? u.role}</span>
              </label>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function FeedbackForm({ round, existing }: { round: RoundDetailT; existing?: RoundDetailT['feedback'][number] }) {
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [rec, setRec] = useState<Recommendation | ''>(existing?.recommendation ?? '');
  const [strengths, setStrengths] = useState(existing?.strengths ?? '');
  const [concerns, setConcerns] = useState(existing?.concerns ?? '');
  const [comments, setComments] = useState(existing?.comments ?? '');
  const submit = useApiMutation(() => api.post(`/rounds/${round.id}/feedback`, { rating, recommendation: rec, strengths: strengths || null, concerns: concerns || null, comments: comments || null }), {
    success: 'Feedback submitted',
    invalidate: [['rounds']],
  });
  return (
    <Card>
      <CardHeader title={existing ? 'Update your feedback' : 'Your feedback'} subtitle="Shared with the hiring team" />
      <div className="space-y-4">
        <Field label="Overall rating" required>
          <Stars value={rating} onChange={setRating} />
        </Field>
        <Field label="Recommendation" required>
          <div className="flex flex-wrap gap-2">
            {RECS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRec(r)}
                className={cx(
                  'cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition',
                  rec === r ? 'border-brand-600 bg-brand-600 text-white' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300',
                )}
              >
                {RECOMMENDATION_LABEL[r]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Strengths">
          <Textarea rows={2} value={strengths} onChange={(e) => setStrengths(e.target.value)} />
        </Field>
        <Field label="Concerns">
          <Textarea rows={2} value={concerns} onChange={(e) => setConcerns(e.target.value)} />
        </Field>
        <Field label="Additional comments">
          <Textarea rows={3} value={comments} onChange={(e) => setComments(e.target.value)} />
        </Field>
        <Button className="w-full" loading={submit.isPending} disabled={!rating || !rec} onClick={() => submit.mutate()}>
          Submit feedback
        </Button>
      </div>
    </Card>
  );
}

function Transcript({ round }: { round: RoundDetailT }) {
  if (!round.messages.length) return <EmptyState icon={<Bot className="size-5" />} title="No transcript yet" description="The conversation appears here once the candidate starts." />;
  return (
    <div className="space-y-3">
      {round.messages.map((m) => (
        <div key={m.seq} className={cx('flex gap-3', m.role === 'candidate' && 'flex-row-reverse')}>
          {m.role === 'interviewer' ? (
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700">
              <Bot className="size-4" />
            </div>
          ) : (
            <Avatar name={round.candidateName} size="sm" />
          )}
          <div className={cx('max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap', m.role === 'interviewer' ? 'rounded-tl-sm bg-zinc-100 text-zinc-800' : 'rounded-tr-sm bg-brand-600 text-white')}>
            {m.content}
          </div>
        </div>
      ))}
    </div>
  );
}

function EvaluationCard({ round }: { round: RoundDetailT }) {
  const ev = round.evaluation;
  return (
    <Card>
      <CardHeader title={round.kind === 'human' ? 'Panel result' : 'AI evaluation'} subtitle={`Pass mark ${round.passScore}`} />
      <div className="flex items-center gap-4">
        <ScoreRing score={round.score} size={72} label="Score" />
        <div className="space-y-1.5">
          {round.passed !== null && (
            <Badge tone={round.passed ? 'green' : 'red'}>
              {round.passed ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
              {round.passed ? 'Passed' : 'Not passed'}
            </Badge>
          )}
          {round.recommendation && (
            <div>
              <StatusBadge value={round.recommendation} label={RECOMMENDATION_LABEL[round.recommendation]} />
            </div>
          )}
          {round.status === 'completed' && round.kind !== 'human' && <p className="text-xs text-zinc-500">Evaluating…</p>}
        </div>
      </div>
      {(ev?.summary || round.aiSummary) && <p className="mt-4 text-sm text-zinc-700">{ev?.summary ?? round.aiSummary}</p>}
      {ev?.competencies?.length ? (
        <div className="mt-5 space-y-3">
          {ev.competencies.map((c) => (
            <div key={c.name}>
              <div className="mb-1 flex justify-between text-xs">
                <span className="font-medium text-zinc-700">{c.name}</span>
                <span className="text-zinc-500">{c.score}</span>
              </div>
              <ProgressBar value={c.score} tone={c.score >= 75 ? 'green' : c.score >= 50 ? 'amber' : 'red'} />
              {c.comment && <p className="mt-1 text-xs text-zinc-500">{c.comment}</p>}
            </div>
          ))}
        </div>
      ) : null}
      {ev && (ev.strengths.length > 0 || ev.concerns.length > 0) && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
              <ThumbsUp className="size-3.5" /> Strengths
            </p>
            <ul className="space-y-1 text-sm text-zinc-700">
              {ev.strengths.map((s, i) => (
                <li key={i}>• {s}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-red-700">
              <ThumbsDown className="size-3.5" /> Concerns
            </p>
            <ul className="space-y-1 text-sm text-zinc-700">
              {ev.concerns.map((s, i) => (
                <li key={i}>• {s}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function RoundDetail() {
  const { id } = useParams<{ id: string }>();
  const { isHR, me } = useAuth();
  const users = useUserMap();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [decision, setDecision] = useState<boolean | null>(null);
  const [note, setNote] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);

  const q = useQuery({
    queryKey: ['rounds', id],
    queryFn: () => api.get<RoundDetailT>(`/rounds/${id}`),
    refetchInterval: (query) => (['in_progress', 'completed'].includes(query.state.data?.status ?? '') ? 5000 : false),
  });
  const invite = useApiMutation(() => api.post(`/rounds/${id}/invite`), { success: 'Interview link sent', invalidate: [['rounds']] });
  const decide = useApiMutation((body: { passed: boolean; note?: string }) => api.post(`/rounds/${id}/decision`, body), { success: 'Decision recorded', invalidate: [['rounds'], ['applications']] });
  const cancel = useApiMutation(() => api.post(`/rounds/${id}/cancel`), { success: 'Round cancelled', invalidate: [['rounds']] });

  useEffect(() => setNote(''), [decision]);
  const round = q.data;
  const myFeedback = useMemo(() => round?.feedback.find((f) => f.interviewerId === me?.id), [round, me]);

  if (q.isLoading) return <PageLoader />;
  if (q.error || !round) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const isAI = round.kind !== 'human';
  const assigned = !!me && round.interviewerIds.includes(me.id);
  const canFeedback = !isAI && (assigned || isHR) && ['scheduled', 'completed', 'evaluated'].includes(round.status);
  const active = !['cancelled', 'evaluated', 'expired'].includes(round.status);

  return (
    <div>
      <PageHeader
        back={
          <Link to="/interviews" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800">
            <ArrowLeft className="size-4" /> Interviews
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {round.name}
            <StatusBadge value={round.status} />
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={isAI ? 'violet' : 'blue'}>
              {isAI ? <Bot className="size-3" /> : <UserRound className="size-3" />}
              {ROUND_KIND_LABEL[round.kind]}
            </Badge>
            Round {round.sequence} ·{' '}
            <Link to={`/candidates/${round.candidateId}`} className="font-medium text-zinc-700 hover:underline">
              {round.candidateName}
            </Link>
            · {round.jobTitle}
          </span>
        }
        actions={
          isHR && (
            <>
              {isAI && ['pending', 'invited', 'expired'].includes(round.status) && (
                <Button icon={<Send className="size-4" />} loading={invite.isPending} onClick={() => invite.mutate()}>
                  {round.status === 'pending' ? 'Send invite' : 'Resend link'}
                </Button>
              )}
              {!isAI && active && (
                <Button icon={<CalendarPlus className="size-4" />} onClick={() => setScheduleOpen(true)}>
                  {round.scheduledAt ? 'Reschedule' : 'Schedule'}
                </Button>
              )}
              <Menu
                trigger={<Button variant="outline" icon={<MoreHorizontal className="size-4" />} />}
                items={[
                  { label: 'Mark as passed', icon: <CheckCircle2 className="size-4" />, onClick: () => setDecision(true), disabled: round.status === 'cancelled' },
                  { label: 'Mark as not passed', icon: <XCircle className="size-4" />, onClick: () => setDecision(false), disabled: round.status === 'cancelled' },
                  active && { label: 'Cancel round', danger: true, onClick: () => setCancelOpen(true) },
                ]}
              />
            </>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {(round.score !== null || round.evaluation || round.status === 'completed') && <EvaluationCard round={round} />}

          {isAI ? (
            <Card>
              <CardHeader title="Interview transcript" subtitle={`${round.messages.filter((m) => m.role === 'candidate').length} of ${round.questionCount} answers`} />
              <Transcript round={round} />
            </Card>
          ) : (
            <Card>
              <CardHeader title="Panel feedback" subtitle={`${round.feedback.length} of ${round.interviewerIds.length} submitted`} />
              {!round.feedback.length ? (
                <EmptyState title="No feedback yet" description="Interviewers can submit feedback after the interview." />
              ) : (
                <div className="space-y-4">
                  {round.feedback.map((f) => (
                    <div key={f.id} className="rounded-lg border border-zinc-200 p-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <Avatar name={users.get(f.interviewerId)?.fullName} size="sm" />
                        <span className="text-sm font-medium">{users.get(f.interviewerId)?.fullName ?? 'Interviewer'}</span>
                        <Stars value={f.rating} size="sm" />
                        <StatusBadge value={f.recommendation} label={RECOMMENDATION_LABEL[f.recommendation]} />
                        <span className="ml-auto text-xs text-zinc-400">{fmtDateTime(f.submittedAt)}</span>
                      </div>
                      <div className="mt-3 space-y-2 text-sm text-zinc-700">
                        {f.strengths && (
                          <p>
                            <span className="font-medium text-emerald-700">Strengths: </span>
                            {f.strengths}
                          </p>
                        )}
                        {f.concerns && (
                          <p>
                            <span className="font-medium text-red-700">Concerns: </span>
                            {f.concerns}
                          </p>
                        )}
                        {f.comments && <p className="text-zinc-600">{f.comments}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <DescriptionList
              cols={1}
              items={[
                { label: 'Candidate', value: `${round.candidateName} · ${round.candidateEmail}` },
                ...(isAI
                  ? [
                      { label: 'Questions', value: round.questionCount },
                      { label: 'Link expires', value: fmtDateTime(round.expiresAt) },
                      { label: 'Started', value: fmtDateTime(round.startedAt) },
                    ]
                  : [
                      { label: 'Scheduled for', value: fmtDateTime(round.scheduledAt) },
                      {
                        label: 'Meeting link',
                        value: round.meetingUrl ? (
                          <a href={round.meetingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                            Join <ExternalLink className="size-3" />
                          </a>
                        ) : (
                          '—'
                        ),
                      },
                      { label: 'Panel', value: round.interviewerIds.map((i) => users.get(i)?.fullName ?? '…').join(', ') || '—' },
                    ]),
                { label: 'Duration', value: `${round.durationMin} min` },
                { label: 'Completed', value: fmtDateTime(round.completedAt) },
                { label: 'Focus areas', value: round.focusAreas || '—' },
              ]}
            />
          </Card>
          {canFeedback && <FeedbackForm key={myFeedback?.id ?? 'new'} round={round} existing={myFeedback} />}
          {round.kind === 'ai_proctored' && <ProctoringPanel integrityScore={round.integrityScore} proctoring={round.proctoring} />}
        </div>
      </div>

      {!isAI && <ScheduleModal key={String(scheduleOpen)} round={round} open={scheduleOpen} onClose={() => setScheduleOpen(false)} />}
      <Modal
        open={decision !== null}
        onClose={() => setDecision(null)}
        size="sm"
        title={decision ? 'Mark round as passed?' : 'Mark round as not passed?'}
        description={decision ? 'The candidate advances to the next round in the series.' : 'The candidate will not advance automatically.'}
        footer={
          <>
            <Button variant="outline" onClick={() => setDecision(null)}>
              Cancel
            </Button>
            <Button
              variant={decision ? 'success' : 'danger'}
              loading={decide.isPending}
              onClick={() => decide.mutate({ passed: !!decision, note: note || undefined }, { onSuccess: () => setDecision(null) })}
            >
              Confirm
            </Button>
          </>
        }
      >
        <Field label="Note (optional)">
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Modal>
      <ConfirmDialog open={cancelOpen} onClose={() => setCancelOpen(false)} onConfirm={() => cancel.mutateAsync()} danger title="Cancel this round?" confirmLabel="Cancel round" />
    </div>
  );
}
