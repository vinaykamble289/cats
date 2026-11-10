import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Briefcase, MapPin, Plus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, humanize, STAGES, STAGE_COLOR, STAGE_LABEL } from '@/lib/format';
import { useDebounced, useDepartments } from '@/lib/hooks';
import type { ApplicationStats, Job, Paginated } from '@/lib/types';
import { JobStatusMenu } from '@/components/jobs/JobStatusMenu';
import { StatusBadge } from '@/components/StatusBadge';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Pagination, SearchInput, Segmented, Select, Spinner, cx } from '@/components/ui';

type Filter = 'active' | 'open' | 'draft' | 'on_hold' | 'closed' | 'all';
const FILTER_STATUS: Record<Filter, string | undefined> = {
  active: 'open,on_hold,draft',
  open: 'open',
  draft: 'draft',
  on_hold: 'on_hold',
  closed: 'closed,filled',
  all: undefined,
};
const PRIORITY_TONE = { low: 'gray', medium: 'blue', high: 'amber', urgent: 'red' } as const;

export default function JobsList() {
  const navigate = useNavigate();
  const { isHR } = useAuth();
  const [filter, setFilter] = useState<Filter>('active');
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(q);
  const { data: departments } = useDepartments();
  const deptName = new Map((departments ?? []).map((d) => [d.id, d.name]));

  const jobs = useQuery({
    queryKey: ['jobs', 'list', { filter, search, dept, page }],
    queryFn: () => api.get<Paginated<Job>>('/jobs', { status: FILTER_STATUS[filter], q: search, departmentId: dept, page, pageSize: 24 }),
    placeholderData: (prev) => prev,
  });
  const stats = useQuery({ queryKey: ['applications', 'stats'], queryFn: () => api.get<ApplicationStats>('/applications/stats'), retry: 1 });
  const byJob = new Map((stats.data?.byJob ?? []).map((j) => [j.jobId, j]));

  return (
    <div>
      <PageHeader
        title="Jobs"
        subtitle="Requisitions, pipelines and hiring plans"
        actions={
          isHR && (
            <Button icon={<Plus className="size-4" />} onClick={() => navigate('/jobs/new')}>
              New job
            </Button>
          )
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'open', label: 'Open' },
            { value: 'draft', label: 'Drafts' },
            { value: 'on_hold', label: 'On hold' },
            { value: 'closed', label: 'Closed' },
            { value: 'all', label: 'All' },
          ]}
        />
        <SearchInput
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          placeholder="Search jobs…"
          className="w-full sm:w-64"
        />
        <Select value={dept} onChange={(e) => setDept(e.target.value)} className="w-full sm:w-48">
          <option value="">All departments</option>
          {(departments ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </div>

      {jobs.isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner className="size-6" />
        </div>
      ) : jobs.isError ? (
        <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} />
      ) : !jobs.data?.data.length ? (
        <EmptyState
          icon={<Briefcase className="size-5" />}
          title={search || filter !== 'active' ? 'No jobs match your filters' : 'No jobs yet'}
          description="Create your first job to start building a pipeline."
          action={
            isHR && (
              <Button icon={<Plus className="size-4" />} onClick={() => navigate('/jobs/new')}>
                Create job
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {jobs.data.data.map((job) => {
              const p = byJob.get(job.id);
              const active = p?.active ?? 0;
              return (
                <Card key={job.id} className="group flex flex-col transition hover:border-zinc-300 hover:shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <Link to={`/jobs/${job.id}`} className="min-w-0 flex-1">
                      <div className="mb-1.5 flex items-center gap-2">
                        <StatusBadge value={job.status} />
                        {job.priority !== 'medium' && <Badge tone={PRIORITY_TONE[job.priority]}>{humanize(job.priority)}</Badge>}
                      </div>
                      <h3 className="truncate text-base font-semibold text-zinc-900 group-hover:text-brand-700">{job.title}</h3>
                      <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-zinc-500">
                        <span>{job.code}</span>
                        {job.departmentId && deptName.get(job.departmentId) && <span>· {deptName.get(job.departmentId)}</span>}
                        <span className="flex items-center gap-0.5">
                          · <MapPin className="size-3" />
                          {job.location || humanize(job.workMode)}
                        </span>
                      </p>
                    </Link>
                    {isHR && <JobStatusMenu job={job} />}
                  </div>

                  <div className="mt-4">
                    <div className="flex h-2 overflow-hidden rounded-full bg-zinc-100">
                      {STAGES.map((s) => {
                        const n = p?.byStage[s] ?? 0;
                        return n ? <div key={s} title={`${STAGE_LABEL[s]}: ${n}`} className={STAGE_COLOR[s]} style={{ width: `${(n / Math.max(1, active)) * 100}%` }} /> : null;
                      })}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                      {STAGES.filter((s) => (p?.byStage[s] ?? 0) > 0)
                        .slice(0, 5)
                        .map((s) => (
                          <span key={s} className="flex items-center gap-1">
                            <span className={cx('size-1.5 rounded-full', STAGE_COLOR[s])} />
                            {STAGE_LABEL[s]} {p?.byStage[s]}
                          </span>
                        ))}
                      {!active && <span>No active candidates</span>}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-3 text-xs text-zinc-500">
                    <span className="flex items-center gap-1">
                      <Users className="size-3.5" /> {active} active · {p?.total ?? 0} total
                    </span>
                    <span>
                      <span className="font-medium text-zinc-800">
                        {job.filled}/{job.openings}
                      </span>{' '}
                      filled
                      {job.targetDate && <> · by {fmtDate(job.targetDate)}</>}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
          <Pagination page={page} pageSize={24} total={jobs.data.total} onChange={setPage} />
        </>
      )}
    </div>
  );
}
