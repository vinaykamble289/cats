import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2, ExternalLink, FileSearch, FileText, Linkedin, Mail, MapPin, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DECISION_LABEL, fromNow, toneFor, until } from '@/lib/format';
import { useApiMutation, useJobMap, useJobs } from '@/lib/hooks';
import type { CandidateDetail, Paginated, Review, ReviewDecision } from '@/lib/types';
import { Avatar, Badge, Button, Card, EmptyState, Field, PageHeader, Segmented, Select, Spinner, Stars, Textarea, cx } from '@/components/ui';
import { AiMatchCard } from '@/components/candidates/AiMatchCard';

const DECISIONS: { value: ReviewDecision; label: string; cls: string; key: string }[] = [
  { value: 'strong_yes', label: 'Strong yes', cls: 'border-emerald-500 bg-emerald-50 text-emerald-700', key: '1' },
  { value: 'yes', label: 'Yes', cls: 'border-emerald-400 bg-emerald-50/60 text-emerald-700', key: '2' },
  { value: 'maybe', label: 'Maybe', cls: 'border-amber-400 bg-amber-50 text-amber-700', key: '3' },
  { value: 'no', label: 'No', cls: 'border-red-400 bg-red-50 text-red-700', key: '4' },
];

function ResumeViewer({ candidateId }: { candidateId: string }) {
  const cand = useQuery({ queryKey: ['candidates', candidateId], queryFn: () => api.get<CandidateDetail>(`/candidates/${candidateId}`) });
  const isPdf = cand.data?.resume?.mimeType === 'application/pdf';
  const url = useQuery({
    queryKey: ['candidates', candidateId, 'resume-url'],
    queryFn: () => api.get<{ url: string }>(`/candidates/${candidateId}/resume/url`),
    enabled: !!cand.data?.resume,
    staleTime: 8 * 60_000,
  });
  const c = cand.data;
  if (cand.isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (!c) return null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500">
        <span className="flex items-center gap-1"><Mail className="size-3.5" />{c.email}</span>
        {c.location && <span className="flex items-center gap-1"><MapPin className="size-3.5" />{c.location}</span>}
        {c.experienceYears !== null && <span>{c.experienceYears} yrs experience</span>}
        {c.noticePeriodDays !== null && <span>{c.noticePeriodDays}d notice</span>}
        {c.linkedinUrl && (
          <a href={c.linkedinUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-brand-700">
            <Linkedin className="size-3.5" />LinkedIn
          </a>
        )}
      </div>
      {c.summary && <p className="text-sm leading-relaxed text-zinc-600">{c.summary}</p>}
      {c.skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {c.skills.map((s) => (
            <Badge key={s}>{s}</Badge>
          ))}
        </div>
      )}
      {c.resume ? (
        <div className="overflow-hidden rounded-xl border border-zinc-200">
          <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50 px-3 py-2 text-sm">
            <FileText className="size-4 text-zinc-400" />
            <span className="flex-1 truncate text-zinc-700">{c.resume.fileName}</span>
            {url.data && (
              <a href={url.data.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                Open <ExternalLink className="size-3" />
              </a>
            )}
          </div>
          {isPdf && url.data ? (
            <iframe title="Resume" src={url.data.url} className="h-[70vh] w-full bg-white" />
          ) : url.isLoading ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : (
            <p className="p-6 text-center text-sm text-zinc-500">Preview is available for PDF files. Use “Open” to download this resume.</p>
          )}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500">No resume on file.</p>
      )}
    </div>
  );
}

function DecisionForm({ review, onSubmitted }: { review: Review; onSubmitted: () => void }) {
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [rating, setRating] = useState(0);
  const [comments, setComments] = useState('');
  useEffect(() => {
    setDecision(null);
    setRating(0);
    setComments('');
  }, [review.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      const d = DECISIONS.find((x) => x.key === e.key);
      if (d) setDecision(d.value);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const submit = useApiMutation(() => api.post(`/reviews/${review.id}/submit`, { decision, rating: rating || 3, comments: comments || undefined }), {
    success: 'Review submitted',
    invalidate: [['reviews'], ['applications'], ['activity']],
    onSuccess: onSubmitted,
  });
  return (
    <Card className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-semibold text-zinc-900">Your decision</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {DECISIONS.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() => setDecision(d.value)}
              className={cx(
                'cursor-pointer rounded-lg border-2 px-3 py-2 text-sm font-medium transition',
                decision === d.value ? d.cls : 'border-zinc-200 text-zinc-600 hover:border-zinc-300',
              )}
            >
              {d.label}
              <span className="ml-1.5 text-[10px] text-zinc-400">{d.key}</span>
            </button>
          ))}
        </div>
      </div>
      <Field label="Overall rating">
        <Stars value={rating} onChange={setRating} />
      </Field>
      <Field label="Comments">
        <Textarea
          rows={3}
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder="What stood out? Any concerns? (Ctrl+Enter to submit)"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && decision) submit.mutate();
          }}
        />
      </Field>
      <div className="flex justify-end">
        <Button icon={<Send className="size-4" />} disabled={!decision} loading={submit.isPending} onClick={() => submit.mutate()}>
          Submit review
        </Button>
      </div>
    </Card>
  );
}

export default function ReviewQueue() {
  const { isHR } = useAuth();
  const jobMap = useJobMap();
  const { data: jobs } = useJobs();
  const [status, setStatus] = useState<'pending' | 'completed'>('pending');
  const [scope, setScope] = useState<'mine' | 'all'>(isHR ? 'all' : 'mine');
  const [jobId, setJobId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const mine = !isHR || scope === 'mine';
  const list = useQuery({
    queryKey: ['reviews', 'queue', { status, mine, jobId }],
    queryFn: () => api.get<Paginated<Review>>('/reviews', { status, mine: mine || undefined, jobId, pageSize: 100 }),
  });
  const reviews = useMemo(() => list.data?.data ?? [], [list.data]);
  const selected = reviews.find((r) => r.id === selectedId) ?? reviews[0] ?? null;

  useEffect(() => {
    if (!selectedId && reviews[0]) setSelectedId(reviews[0].id);
  }, [reviews, selectedId]);

  const advance = () => {
    const idx = reviews.findIndex((r) => r.id === selected?.id);
    const next = reviews[idx + 1] ?? reviews[idx - 1] ?? null;
    setSelectedId(next?.id ?? null);
  };

  const app = selected?.application;
  const canDecide = selected?.status === 'pending' && (mine || isHR);

  return (
    <div>
      <PageHeader
        title="Resume reviews"
        subtitle={status === 'pending' ? `${list.data?.total ?? 0} resume(s) waiting for a decision` : 'Reviews already submitted'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isHR && (
              <>
                <Segmented value={scope} onChange={setScope} options={[{ value: 'all', label: 'Everyone' }, { value: 'mine', label: 'Assigned to me' }]} />
                <Select value={jobId} onChange={(e) => setJobId(e.target.value)} className="w-52">
                  <option value="">All jobs</option>
                  {(jobs ?? []).map((j) => (
                    <option key={j.id} value={j.id}>{j.title}</option>
                  ))}
                </Select>
              </>
            )}
            <Segmented
              value={status}
              onChange={(v) => {
                setStatus(v);
                setSelectedId(null);
              }}
              options={[{ value: 'pending', label: 'Pending' }, { value: 'completed', label: 'Completed' }]}
            />
          </div>
        }
      />

      {list.isLoading ? (
        <div className="flex justify-center py-20"><Spinner className="size-6" /></div>
      ) : !reviews.length ? (
        <EmptyState
          icon={status === 'pending' ? <CheckCircle2 className="size-5" /> : <FileSearch className="size-5" />}
          title={status === 'pending' ? 'Inbox zero — nothing to review' : 'No completed reviews yet'}
          description={status === 'pending' ? 'You will get an email when new resumes are assigned to you.' : undefined}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <div className="scroll-thin space-y-1.5 lg:max-h-[calc(100vh-200px)] lg:overflow-y-auto lg:pr-1">
            {reviews.map((r) => {
              const a = r.application;
              const active = r.id === selected?.id;
              return (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={cx(
                    'flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition',
                    active ? 'border-brand-300 bg-brand-50/60 ring-2 ring-brand-500/10' : 'border-zinc-200 bg-white hover:border-zinc-300',
                  )}
                >
                  <Avatar name={a?.candidate.fullName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900">{a?.candidate.fullName ?? 'Candidate'}</p>
                    <p className="truncate text-xs text-zinc-500">{a ? jobMap.get(a.jobId)?.title : ''}</p>
                    <div className="mt-1 flex items-center gap-2">
                      {r.status === 'completed' && r.decision ? (
                        <Badge tone={toneFor(r.decision)}>{DECISION_LABEL[r.decision]}</Badge>
                      ) : r.dueAt ? (
                        <span className={cx('text-[11px]', new Date(r.dueAt) < new Date() ? 'font-medium text-red-600' : 'text-zinc-500')}>Due {until(r.dueAt)}</span>
                      ) : (
                        <span className="text-[11px] text-zinc-400">Requested {fromNow(r.requestedAt)}</span>
                      )}
                    </div>
                  </div>
                  {a?.aiMatchScore !== null && a?.aiMatchScore !== undefined && <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-xs font-semibold text-violet-700">{a.aiMatchScore}</span>}
                </button>
              );
            })}
          </div>

          {selected && app ? (
            <div className="min-w-0 space-y-5">
              <Card>
                <div className="flex flex-wrap items-start gap-4">
                  <Avatar name={app.candidate.fullName} size="lg" />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold text-zinc-900">{app.candidate.fullName}</h2>
                    <p className="text-sm text-zinc-500">
                      {[app.candidate.currentTitle, app.candidate.currentCompany].filter(Boolean).join(' at ') || '—'} · for <span className="font-medium text-zinc-700">{jobMap.get(app.jobId)?.title ?? 'job'}</span>
                    </p>
                  </div>
                  <Link to={`/candidates/${app.candidateId}`}>
                    <Button size="sm" variant="outline" icon={<ExternalLink className="size-4" />}>Full profile</Button>
                  </Link>
                </div>
              </Card>
              {canDecide && <DecisionForm review={selected} onSubmitted={advance} />}
              {selected.status === 'completed' && (
                <Card>
                  <div className="flex items-center gap-3">
                    {selected.decision && <Badge tone={toneFor(selected.decision)}>{DECISION_LABEL[selected.decision]}</Badge>}
                    {selected.rating && <Stars value={selected.rating} size="sm" />}
                    <span className="ml-auto text-xs text-zinc-400">Submitted {fromNow(selected.submittedAt)}</span>
                  </div>
                  {selected.comments && <p className="mt-2 text-sm text-zinc-600">{selected.comments}</p>}
                </Card>
              )}
              <AiMatchCard application={app} />
              <Card>
                <ResumeViewer candidateId={app.candidateId} />
              </Card>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
