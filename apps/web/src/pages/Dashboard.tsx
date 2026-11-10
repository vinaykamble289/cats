import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Briefcase, CalendarClock, FileSearch, Handshake, MessageSquareText, Plus, Trophy, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, ROUND_KIND_LABEL, STAGES, STAGE_COLOR, STAGE_LABEL, until } from '@/lib/format';
import type { ApplicationStats, Job, JobStatus, Paginated, Review, Round } from '@/lib/types';
import { ActivityFeed } from '@/components/ActivityFeed';
import { StatusBadge } from '@/components/StatusBadge';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, PageHeader, Spinner, StatCard, cx } from '@/components/ui';

interface JobStats {
  total: number;
  byStatus: Partial<Record<JobStatus, number>>;
  openPositions: number;
}
interface RoundStats {
  byStatus: Record<string, number>;
  upcoming: number;
  awaitingFeedback: number;
  completedThisWeek: number;
}
interface OfferStats {
  byStatus: Record<string, number>;
  acceptanceRate: number | null;
}

/** Each widget query fails independently (retry once, no page-level error). */
const opts = { retry: 1, staleTime: 30_000 } as const;
const show = (v: number | undefined | null, loading: boolean) => (loading ? <Spinner className="size-5" /> : v ?? '—');

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function HRDashboard() {
  const navigate = useNavigate();
  const jobStats = useQuery({ queryKey: ['jobs', 'stats'], queryFn: () => api.get<JobStats>('/jobs/stats'), ...opts });
  const appStats = useQuery({ queryKey: ['applications', 'stats'], queryFn: () => api.get<ApplicationStats>('/applications/stats'), ...opts });
  const roundStats = useQuery({ queryKey: ['rounds', 'stats'], queryFn: () => api.get<RoundStats>('/rounds/stats'), ...opts });
  const offerStats = useQuery({ queryKey: ['offers', 'stats'], queryFn: () => api.get<OfferStats>('/offers/stats'), ...opts });
  const pendingReviews = useQuery({ queryKey: ['reviews', 'pending-count'], queryFn: () => api.get<Paginated<Review>>('/reviews', { status: 'pending', pageSize: 1 }), ...opts });
  const openJobs = useQuery({ queryKey: ['jobs', 'list', { status: 'open' }], queryFn: () => api.get<Paginated<Job>>('/jobs', { status: 'open', pageSize: 8 }), ...opts });
  const upcoming = useQuery({ queryKey: ['rounds', 'upcoming'], queryFn: () => api.get<Paginated<Round>>('/rounds', { upcoming: true, pageSize: 6 }), ...opts });

  const offersPending = offerStats.data ? (offerStats.data.byStatus.sent ?? 0) + (offerStats.data.byStatus.negotiating ?? 0) : undefined;
  const byStage = appStats.data?.byStage ?? {};
  const maxStage = Math.max(1, ...STAGES.map((s) => byStage[s] ?? 0));
  const byJob = new Map((appStats.data?.byJob ?? []).map((j) => [j.jobId, j]));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Open positions" value={show(jobStats.data?.openPositions, jobStats.isLoading)} hint={jobStats.data ? `${jobStats.data.byStatus.open ?? 0} open jobs` : undefined} icon={<Briefcase className="size-4" />} />
        <StatCard label="Active candidates" value={show(appStats.data?.active, appStats.isLoading)} hint={appStats.data ? `${appStats.data.total} total applications` : undefined} icon={<Users className="size-4" />} tone="sky" />
        <StatCard label="Pending reviews" value={show(pendingReviews.data?.total, pendingReviews.isLoading)} icon={<FileSearch className="size-4" />} tone="violet" />
        <StatCard label="Upcoming interviews" value={show(roundStats.data?.upcoming, roundStats.isLoading)} hint={roundStats.data ? `${roundStats.data.awaitingFeedback} awaiting feedback` : undefined} icon={<CalendarClock className="size-4" />} tone="amber" />
        <StatCard
          label="Offers pending"
          value={show(offersPending, offerStats.isLoading)}
          hint={offerStats.data?.acceptanceRate != null ? `${Math.round(offerStats.data.acceptanceRate * (offerStats.data.acceptanceRate <= 1 ? 100 : 1))}% acceptance` : undefined}
          icon={<Handshake className="size-4" />}
          tone="rose"
        />
        <StatCard label="Hired this month" value={show(appStats.data?.hiredThisMonth, appStats.isLoading)} icon={<Trophy className="size-4" />} tone="green" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Hiring funnel" subtitle="Active candidates in each stage, across all jobs" />
          {appStats.isLoading ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : appStats.isError ? (
            <p className="py-6 text-sm text-zinc-500">Pipeline data is temporarily unavailable.</p>
          ) : (
            <div className="space-y-1">
              {STAGES.map((s) => {
                const n = byStage[s] ?? 0;
                return (
                  <div key={s} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-3 py-1 sm:grid-cols-[9rem_1fr_3rem]">
                    <span className="truncate text-sm text-zinc-600">{STAGE_LABEL[s]}</span>
                    <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100">
                      <div className={cx('h-full rounded-full transition-all duration-500', STAGE_COLOR[s])} style={{ width: `${Math.max(n ? 3 : 0, (n / maxStage) * 100)}%` }} />
                    </div>
                    <span className={cx('tabular text-right text-sm font-medium', n ? 'text-zinc-900' : 'text-zinc-400')}>{n}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Upcoming interviews"
            actions={
              <Link to="/interviews" className="text-xs font-medium text-brand-600 hover:underline">
                View all
              </Link>
            }
          />
          {upcoming.isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : !upcoming.data?.data.length ? (
            <EmptyState icon={<CalendarClock className="size-5" />} title="Nothing scheduled" description="Live interviews you schedule will show up here." />
          ) : (
            <ul className="space-y-1">
              {upcoming.data.data.map((r) => (
                <li key={r.id}>
                  <Link to={`/interviews/${r.id}`} className="flex items-center gap-3 rounded-lg p-2 hover:bg-zinc-50">
                    <Avatar name={r.candidateName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-900">{r.candidateName}</p>
                      <p className="truncate text-xs text-zinc-500">
                        {r.name} · {ROUND_KIND_LABEL[r.kind]}
                      </p>
                    </div>
                    <div className="text-right text-xs">
                      <p className="font-medium text-zinc-700">{r.scheduledAt ? fmtDateTime(r.scheduledAt) : r.expiresAt ? `Due ${until(r.expiresAt)}` : '—'}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card padded={false} className="xl:col-span-2">
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h3 className="text-sm font-semibold text-zinc-900">Open jobs</h3>
            <Link to="/jobs" className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
              All jobs <ArrowRight className="size-3" />
            </Link>
          </div>
          {openJobs.isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : !openJobs.data?.data.length ? (
            <div className="px-5 pb-5">
              <EmptyState
                icon={<Briefcase className="size-5" />}
                title="No open jobs"
                description="Create a job to start receiving candidates."
                action={
                  <Button size="sm" icon={<Plus className="size-4" />} onClick={() => navigate('/jobs/new')}>
                    Create job
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {openJobs.data.data.map((j) => {
                const p = byJob.get(j.id);
                return (
                  <Link key={j.id} to={`/jobs/${j.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-zinc-50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-900">{j.title}</p>
                      <p className="text-xs text-zinc-500">
                        {j.code} · {j.location ?? 'Any location'}
                      </p>
                    </div>
                    <div className="hidden w-40 sm:block">
                      <div className="flex h-1.5 overflow-hidden rounded-full bg-zinc-100">
                        {STAGES.map((s) => {
                          const n = p?.byStage[s] ?? 0;
                          return n ? <div key={s} className={STAGE_COLOR[s]} style={{ width: `${(n / Math.max(1, p!.active)) * 100}%` }} /> : null;
                        })}
                      </div>
                      <p className="mt-1 text-[11px] text-zinc-500">{p?.active ?? 0} active</p>
                    </div>
                    <div className="w-20 text-right">
                      <p className="text-sm font-medium text-zinc-900">
                        {j.filled}/{j.openings}
                      </p>
                      <p className="text-[11px] text-zinc-500">filled</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Recent activity" />
          <div className="scroll-thin max-h-[420px] overflow-y-auto pr-1">
            <ActivityFeed limit={20} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function TeamMemberDashboard() {
  const { hasRole } = useAuth();
  const reviews = useQuery({ queryKey: ['reviews', 'mine', 'pending'], queryFn: () => api.get<Paginated<Review>>('/reviews', { mine: true, status: 'pending', pageSize: 10 }), ...opts });
  const rounds = useQuery({
    queryKey: ['rounds', 'mine'],
    queryFn: () => api.get<Paginated<Round>>('/rounds', { mine: true, pageSize: 10 }),
    enabled: hasRole('interviewer', 'hiring_manager'),
    ...opts,
  });
  const activeRounds = (rounds.data?.data ?? []).filter((r) => ['scheduled', 'completed', 'invited', 'pending', 'in_progress'].includes(r.status));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Resumes waiting for your review"
          subtitle={reviews.data ? `${reviews.data.total} pending` : undefined}
          actions={
            <Link to="/reviews">
              <Button size="sm" variant="outline" icon={<FileSearch className="size-4" />}>
                Open queue
              </Button>
            </Link>
          }
        />
        {reviews.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : !reviews.data?.data.length ? (
          <EmptyState icon={<FileSearch className="size-5" />} title="You're all caught up" description="New review requests will appear here and in your inbox." />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {reviews.data.data.map((r) => (
              <li key={r.id}>
                <Link to="/reviews" className="flex items-center gap-3 py-2.5">
                  <Avatar name={r.application?.candidate.fullName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900">{r.application?.candidate.fullName}</p>
                    <p className="truncate text-xs text-zinc-500">{r.application?.candidate.currentTitle ?? '—'}</p>
                  </div>
                  {r.dueAt && <Badge tone="amber">Due {until(r.dueAt)}</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {hasRole('interviewer', 'hiring_manager') && (
        <Card>
          <CardHeader title="Your interviews" subtitle="Rounds where you're on the panel" />
          {rounds.isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : !activeRounds.length ? (
            <EmptyState icon={<MessageSquareText className="size-5" />} title="No interviews assigned" />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {activeRounds.map((r) => (
                <li key={r.id}>
                  <Link to={`/interviews/${r.id}`} className="flex items-center gap-3 py-2.5">
                    <Avatar name={r.candidateName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-900">{r.candidateName}</p>
                      <p className="truncate text-xs text-zinc-500">
                        {r.name} · {r.jobTitle}
                      </p>
                    </div>
                    <div className="text-right">
                      <StatusBadge value={r.status} />
                      {r.scheduledAt && <p className="mt-1 text-xs text-zinc-500">{fmtDateTime(r.scheduledAt)}</p>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { me, isHR, hasRole } = useAuth();
  const navigate = useNavigate();
  const firstName = (me?.fullName || me?.email || '').split(/[\s@]/)[0];
  const showHR = isHR || hasRole('hiring_manager');
  return (
    <div>
      <PageHeader
        title={`${greeting()}${firstName ? `, ${firstName}` : ''}`}
        subtitle={showHR ? "Here's what's happening across your hiring pipeline." : 'Your hiring tasks at a glance.'}
        actions={
          isHR && (
            <>
              <Button variant="outline" icon={<Users className="size-4" />} onClick={() => navigate('/candidates')}>
                Candidates
              </Button>
              <Button icon={<Plus className="size-4" />} onClick={() => navigate('/jobs/new')}>
                New job
              </Button>
            </>
          )
        }
      />
      {showHR ? <HRDashboard /> : <TeamMemberDashboard />}
    </div>
  );
}

