import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bot, CalendarClock, CheckCircle2, MessageSquareWarning, UserRound, Video } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, ROUND_KIND_LABEL, RECOMMENDATION_LABEL, scoreTone, until } from '@/lib/format';
import type { Paginated, Round } from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';
import { Avatar, Badge, Checkbox, EmptyState, ErrorState, PageHeader, PageLoader, Pagination, Segmented, StatCard, Table, Td, Th, Tr, cx } from '@/components/ui';

type View = 'upcoming' | 'feedback' | 'ai' | 'pending' | 'all';

interface RoundStats {
  byStatus: Record<string, number>;
  upcoming: number;
  awaitingFeedback: number;
  completedThisWeek: number;
}

const VIEW_QUERY: Record<View, Record<string, string | boolean | undefined>> = {
  upcoming: { upcoming: true },
  feedback: { status: 'scheduled,completed', kind: 'human' },
  ai: { status: 'completed,evaluated', kind: 'ai_screening,ai_proctored' },
  pending: { status: 'pending,invited' },
  all: {},
};

export default function InterviewsList() {
  const navigate = useNavigate();
  const { hasRole, me } = useAuth();
  const onlyInterviewer = me?.role === 'interviewer';
  const [view, setView] = useState<View>('upcoming');
  const [mine, setMine] = useState(onlyInterviewer || !hasRole('recruiter'));
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const stats = useQuery({ queryKey: ['rounds', 'stats'], queryFn: () => api.get<RoundStats>('/rounds/stats') });
  const list = useQuery({
    queryKey: ['rounds', { view, mine, page }],
    queryFn: () => api.get<Paginated<Round>>('/rounds', { ...VIEW_QUERY[view], mine: mine || undefined, page, pageSize }),
    refetchInterval: 30_000,
  });

  const s = stats.data;
  return (
    <div>
      <PageHeader title="Interviews" subtitle="AI screening, proctored AI rounds and live panel interviews" />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Upcoming live" value={s?.upcoming ?? '—'} icon={<CalendarClock className="size-5" />} tone="sky" />
        <StatCard label="Awaiting feedback" value={s?.awaitingFeedback ?? '—'} icon={<MessageSquareWarning className="size-5" />} tone="amber" />
        <StatCard label="In progress (AI)" value={s?.byStatus.in_progress ?? 0} icon={<Bot className="size-5" />} tone="violet" />
        <StatCard label="Completed this week" value={s?.completedThisWeek ?? '—'} icon={<CheckCircle2 className="size-5" />} tone="green" />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={view}
          onChange={(v) => {
            setView(v);
            setPage(1);
          }}
          options={[
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'feedback', label: 'Live rounds' },
            { value: 'ai', label: 'AI results' },
            { value: 'pending', label: 'Pending / invited' },
            { value: 'all', label: 'All' },
          ]}
        />
        {!onlyInterviewer && (
          <Checkbox
            label="Only my interviews"
            checked={mine}
            onChange={(e) => {
              setMine(e.target.checked);
              setPage(1);
            }}
          />
        )}
      </div>

      {list.isLoading ? (
        <PageLoader />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.data.length ? (
        <EmptyState icon={<Video className="size-5" />} title="Nothing here" description="Start an interview series from a job pipeline to see rounds here." />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Candidate</Th>
                <Th>Round</Th>
                <Th>Status</Th>
                <Th>When</Th>
                <Th>Result</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.data.map((r) => (
                <Tr key={r.id} onClick={() => navigate(`/interviews/${r.id}`)}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={r.candidateName} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-zinc-900">{r.candidateName}</p>
                        <p className="truncate text-xs text-zinc-500">{r.jobTitle}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <p className="text-sm text-zinc-900">
                      {r.sequence}. {r.name}
                    </p>
                    <Badge tone={r.kind === 'human' ? 'blue' : 'violet'} className="mt-1">
                      {r.kind === 'human' ? <UserRound className="size-3" /> : <Bot className="size-3" />}
                      {ROUND_KIND_LABEL[r.kind]}
                    </Badge>
                  </Td>
                  <Td>
                    <StatusBadge value={r.status} />
                  </Td>
                  <Td className="text-xs whitespace-nowrap">
                    {r.scheduledAt ? (
                      <>
                        <p className="text-zinc-900">{fmtDateTime(r.scheduledAt)}</p>
                        <p className="text-zinc-500">{new Date(r.scheduledAt) > new Date() ? until(r.scheduledAt) : ''}</p>
                      </>
                    ) : r.completedAt ? (
                      `Completed ${fmtDateTime(r.completedAt)}`
                    ) : r.expiresAt && r.status === 'invited' ? (
                      `Link expires ${fmtDateTime(r.expiresAt)}`
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>
                    {r.score !== null ? (
                      <div className="flex items-center gap-2">
                        <span className={cx('font-semibold', scoreTone(r.score))}>{r.score}</span>
                        {r.recommendation && <StatusBadge value={r.recommendation} label={RECOMMENDATION_LABEL[r.recommendation]} />}
                      </div>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={pageSize} total={list.data.total} onChange={setPage} />
        </>
      )}
    </div>
  );
}
