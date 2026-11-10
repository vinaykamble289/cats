import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bot, Calendar, Columns3, Link2, List, MapPin, Pencil, Play, UploadCloud, UserRound, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtMoney, humanize, ROUND_KIND_LABEL, scoreTone, STAGE_LABEL, STATUS_LABEL } from '@/lib/format';
import { useApiMutation, useDepartments, useUserMap } from '@/lib/hooks';
import type { Application, Job, Paginated } from '@/lib/types';
import { ActivityFeed } from '@/components/ActivityFeed';
import { Markdown } from '@/components/Markdown';
import { StageBadge, StatusBadge } from '@/components/StatusBadge';
import { Avatar, Badge, Button, Card, CardHeader, DescriptionList, EmptyState, ErrorState, PageHeader, PageLoader, SearchInput, Segmented, Spinner, Table, Tabs, Td, Th, Tr, cx } from '@/components/ui';
import { BulkActionBar } from '@/components/jobs/BulkActionBar';
import { JobStatusMenu } from '@/components/jobs/JobStatusMenu';
import { PipelineBoard, ReviewChips, daysIn } from '@/components/jobs/PipelineBoard';
import { ResumeUploader } from '@/components/candidates/ResumeUploader';

type Tab = 'pipeline' | 'upload' | 'details' | 'activity';

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isHR } = useAuth();
  const users = useUserMap();
  const { data: departments } = useDepartments();
  const [tab, setTab] = useState<Tab>('pipeline');
  const [view, setView] = useState<'board' | 'table'>('board');
  const [scope, setScope] = useState<'active' | 'inactive'>('active');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const job = useQuery({ queryKey: ['jobs', id], queryFn: () => api.get<Job>(`/jobs/${id}`) });
  const statusFilter = scope === 'active' ? 'active,on_hold' : 'rejected,withdrawn,hired';
  const appsKey = ['applications', 'job', id, statusFilter];
  const apps = useQuery({
    queryKey: appsKey,
    queryFn: () => api.get<Paginated<Application>>('/applications', { jobId: id, status: statusFilter, pageSize: 500 }),
    enabled: !!id,
  });

  const publish = useApiMutation(() => api.post<Job>(`/jobs/${id}/status`, { status: 'open' }), { success: 'Job published', invalidate: [['jobs']] });

  const filtered = useMemo(() => {
    const list = apps.data?.data ?? [];
    if (!q.trim()) return list;
    const needle = q.toLowerCase();
    return list.filter((a) => `${a.candidate.fullName} ${a.candidate.email} ${a.candidate.currentTitle ?? ''} ${a.candidate.skills.join(' ')}`.toLowerCase().includes(needle));
  }, [apps.data, q]);

  if (job.isLoading) return <PageLoader />;
  if (job.isError || !job.data) return <ErrorState error={job.error} onRetry={() => job.refetch()} />;
  const j = job.data;
  const applyLink = `${window.location.origin}/careers/${j.slug}`;
  const dept = departments?.find((d) => d.id === j.departmentId)?.name;
  const canEdit = isHR && scope === 'active';

  const toggle = (appId: string) => {
    const next = new Set(selected);
    if (next.has(appId)) next.delete(appId);
    else next.add(appId);
    setSelected(next);
  };

  return (
    <div className={cx(selected.size > 0 && 'pb-20')}>
      <PageHeader
        back={
          <Link to="/jobs" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800">
            <ArrowLeft className="size-4" /> Jobs
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            {j.title}
            <StatusBadge value={j.status} />
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{j.code}</span>
            {dept && <span>{dept}</span>}
            <span className="flex items-center gap-1">
              <MapPin className="size-3.5" />
              {j.location || 'Any location'} · {humanize(j.workMode)}
            </span>
            <span className="flex items-center gap-1">
              <Users className="size-3.5" />
              {j.filled}/{j.openings} filled
            </span>
            {j.targetDate && (
              <span className="flex items-center gap-1">
                <Calendar className="size-3.5" />
                Target {fmtDate(j.targetDate)}
              </span>
            )}
          </span>
        }
        actions={
          <>
            {j.status === 'open' && (
              <Button
                variant="outline"
                icon={<Link2 className="size-4" />}
                onClick={() => {
                  void navigator.clipboard.writeText(applyLink);
                  toast.success('Apply link copied', { description: applyLink });
                }}
              >
                Copy apply link
              </Button>
            )}
            {isHR && (
              <>
                <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => navigate(`/jobs/${j.id}/edit`)}>
                  Edit
                </Button>
                {j.status === 'draft' && (
                  <Button icon={<Play className="size-4" />} loading={publish.isPending} onClick={() => publish.mutate()}>
                    Publish
                  </Button>
                )}
                <JobStatusMenu job={j} />
              </>
            )}
          </>
        }
      />

      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'pipeline', label: 'Pipeline', count: scope === 'active' ? apps.data?.total : undefined },
          ...(isHR ? [{ value: 'upload' as Tab, label: 'Add resumes' }] : []),
          { value: 'details', label: 'Job details' },
          { value: 'activity', label: 'Activity' },
        ]}
      />

      {tab === 'pipeline' && (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'board', label: <span className="flex items-center gap-1.5"><Columns3 className="size-3.5" />Board</span> },
                { value: 'table', label: <span className="flex items-center gap-1.5"><List className="size-3.5" />Table</span> },
              ]}
            />
            <Segmented
              value={scope}
              onChange={(v) => {
                setScope(v);
                setSelected(new Set());
              }}
              options={[
                { value: 'active', label: 'In process' },
                { value: 'inactive', label: 'Rejected / hired' },
              ]}
            />
            <SearchInput value={q} onChange={setQ} placeholder="Filter candidates…" className="w-full sm:w-64" />
            {apps.isFetching && <Spinner className="size-4" />}
          </div>

          {apps.isLoading ? (
            <div className="flex justify-center py-16">
              <Spinner className="size-6" />
            </div>
          ) : apps.isError ? (
            <ErrorState error={apps.error} onRetry={() => apps.refetch()} />
          ) : !apps.data?.data.length && scope === 'active' ? (
            <EmptyState
              icon={<Users className="size-5" />}
              title="No candidates yet"
              description={j.status === 'open' ? 'Share the apply link or upload resumes to start building the pipeline.' : 'Publish the job or upload resumes to start building the pipeline.'}
              action={
                isHR && (
                  <Button icon={<UploadCloud className="size-4" />} onClick={() => setTab('upload')}>
                    Upload resumes
                  </Button>
                )
              }
            />
          ) : view === 'board' && scope === 'active' ? (
            <PipelineBoard applications={filtered} queryKey={appsKey} selected={selected} setSelected={setSelected} canEdit={canEdit} />
          ) : (
            <Table>
              <thead>
                <tr>
                  {canEdit && (
                    <Th className="w-10">
                      <input
                        type="checkbox"
                        className="size-3.5 cursor-pointer accent-brand-600"
                        checked={filtered.length > 0 && filtered.every((a) => selected.has(a.id))}
                        onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((a) => a.id)) : new Set())}
                      />
                    </Th>
                  )}
                  <Th>Candidate</Th>
                  <Th>Stage</Th>
                  <Th>AI match</Th>
                  <Th>Reviews</Th>
                  <Th>Experience</Th>
                  <Th>In stage</Th>
                  <Th>Applied</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <Tr key={a.id} onClick={() => navigate(`/candidates/${a.candidateId}`)}>
                    {canEdit && (
                      <Td className="w-10">
                        <input type="checkbox" className="size-3.5 cursor-pointer accent-brand-600" checked={selected.has(a.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(a.id)} />
                      </Td>
                    )}
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={a.candidate.fullName} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-zinc-900">{a.candidate.fullName}</p>
                          <p className="truncate text-xs text-zinc-500">{a.candidate.currentTitle ?? a.candidate.email}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      {a.status === 'active' ? (
                        <StageBadge stage={a.stage} />
                      ) : (
                        <span className="flex items-center gap-2">
                          <StatusBadge value={a.status} label={STATUS_LABEL[a.status]} />
                          <span className="text-xs text-zinc-400">at {STAGE_LABEL[a.stage]}</span>
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span className={cx('font-semibold', scoreTone(a.aiMatchScore))}>{a.aiMatchScore ?? '—'}</span>
                    </Td>
                    <Td>
                      <ReviewChips s={a.reviewSummary} />
                    </Td>
                    <Td>{a.candidate.experienceYears !== null ? `${a.candidate.experienceYears} yrs` : '—'}</Td>
                    <Td>{daysIn(a.stageChangedAt)}d</Td>
                    <Td className="text-zinc-500">{fmtDate(a.appliedAt)}</Td>
                  </Tr>
                ))}
                {!filtered.length && (
                  <tr>
                    <Td colSpan={8} className="py-10 text-center text-zinc-500">
                      No candidates here.
                    </Td>
                  </tr>
                )}
              </tbody>
            </Table>
          )}
          {isHR && <BulkActionBar ids={[...selected]} jobId={j.id} defaultReviewerIds={j.reviewerIds} onClear={() => setSelected(new Set())} />}
        </div>
      )}

      {tab === 'upload' && (
        <Card className="max-w-3xl">
          <CardHeader title="Add resumes to this job" subtitle="Each resume is parsed by AI, de-duplicated by email, added to the pipeline and scored against this job." />
          <ResumeUploader jobId={j.id} />
        </Card>
      )}

      {tab === 'details' && (
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Description" />
            <Markdown text={j.description} />
          </Card>
          <div className="space-y-6">
            <Card>
              <CardHeader title="Overview" />
              <DescriptionList
                cols={1}
                items={[
                  { label: 'Employment', value: `${humanize(j.employmentType)} · ${humanize(j.workMode)}` },
                  { label: 'Experience', value: j.experienceMin !== null || j.experienceMax !== null ? `${j.experienceMin ?? 0} – ${j.experienceMax ?? '∞'} years` : '—' },
                  { label: 'Salary', value: j.salaryMin || j.salaryMax ? `${fmtMoney(j.salaryMin, j.currency)} – ${fmtMoney(j.salaryMax, j.currency)}` : '—' },
                  { label: 'Priority', value: humanize(j.priority) },
                  { label: 'Hiring manager', value: (j.hiringManagerId && users.get(j.hiringManagerId)?.fullName) || '—' },
                  { label: 'Recruiter', value: (j.recruiterId && users.get(j.recruiterId)?.fullName) || '—' },
                  { label: 'Reviewers', value: j.reviewerIds.map((r) => users.get(r)?.fullName).filter(Boolean).join(', ') || '—' },
                  { label: 'Published', value: fmtDate(j.publishedAt) },
                ]}
              />
            </Card>
            <Card>
              <CardHeader title="Skills" />
              <div className="flex flex-wrap gap-1.5">
                {j.skills.length ? j.skills.map((s) => <Badge key={s.name} tone={s.isRequired ? 'blue' : 'gray'}>{s.name}</Badge>) : <p className="text-sm text-zinc-400">No skills listed.</p>}
              </div>
            </Card>
            <Card>
              <CardHeader title="Interview plan" />
              <ol className="space-y-2">
                {(j.interviewPlan ?? []).map((r, i) => (
                  <li key={r.id ?? i} className="flex items-center gap-3 rounded-lg border border-zinc-100 p-2.5">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-600">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-900">{r.name}</p>
                      <p className="text-xs text-zinc-500">
                        {r.durationMin} min{r.kind !== 'human' ? ` · ${r.questionCount} Qs · pass ${r.passScore}` : ''}
                      </p>
                    </div>
                    <Badge tone={r.kind === 'human' ? 'blue' : 'violet'}>
                      {r.kind === 'human' ? <UserRound className="size-3" /> : <Bot className="size-3" />}
                      {ROUND_KIND_LABEL[r.kind]}
                    </Badge>
                  </li>
                ))}
                {!j.interviewPlan?.length && <p className="text-sm text-zinc-400">No rounds configured.</p>}
              </ol>
            </Card>
          </div>
        </div>
      )}

      {tab === 'activity' && (
        <Card className="max-w-3xl">
          <ActivityFeed jobId={j.id} limit={100} />
        </Card>
      )}
    </div>
  );
}
