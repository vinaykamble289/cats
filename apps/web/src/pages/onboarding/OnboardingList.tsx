import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CalendarCheck, FileClock, ShieldAlert, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, until } from '@/lib/format';
import type { CaseStatus, OnboardingCase, Paginated } from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';
import { Avatar, EmptyState, ErrorState, PageHeader, PageLoader, Pagination, ProgressBar, Select, StatCard, Table, Td, Th, Tr } from '@/components/ui';

interface CaseStats {
  byStatus: Partial<Record<CaseStatus, number>>;
  joiningNext30Days: number;
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All active' },
  { value: 'collecting_documents', label: 'Collecting documents' },
  { value: 'documents_submitted', label: 'Documents submitted' },
  { value: 'bgv_in_progress', label: 'BGV in progress' },
  { value: 'bgv_cleared', label: 'BGV cleared' },
  { value: 'bgv_flagged', label: 'BGV flagged' },
  { value: 'joined', label: 'Joined' },
  { value: 'dropped', label: 'Dropped' },
];

export default function OnboardingList() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const stats = useQuery({ queryKey: ['onboarding', 'stats'], queryFn: () => api.get<CaseStats>('/onboarding/stats') });
  const list = useQuery({
    queryKey: ['onboarding', { status, page }],
    queryFn: () =>
      api.get<Paginated<OnboardingCase>>('/onboarding', {
        status: status || 'collecting_documents,documents_submitted,bgv_in_progress,bgv_cleared,bgv_flagged',
        page,
        pageSize,
      }),
  });
  const s = stats.data?.byStatus ?? {};

  return (
    <div>
      <PageHeader title="Pre-joining & BGV" subtitle="Document collection, background verification and joining confirmation" />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Collecting documents" value={s.collecting_documents ?? 0} icon={<FileClock className="size-5" />} tone="sky" />
        <StatCard label="BGV in progress" value={(s.documents_submitted ?? 0) + (s.bgv_in_progress ?? 0)} icon={<ShieldCheck className="size-5" />} tone="violet" />
        <StatCard label="Flagged" value={s.bgv_flagged ?? 0} icon={<ShieldAlert className="size-5" />} tone="rose" />
        <StatCard label="Joining in 30 days" value={stats.data?.joiningNext30Days ?? '—'} icon={<CalendarCheck className="size-5" />} tone="green" />
      </div>

      <div className="mb-4 flex justify-end">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="w-60"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      {list.isLoading ? (
        <PageLoader />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.data.length ? (
        <EmptyState icon={<ShieldCheck className="size-5" />} title="No pre-joining cases" description="Cases are created automatically when a candidate accepts an offer." />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Candidate</Th>
                <Th>Joining</Th>
                <Th>Documents</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.data.map((c) => {
                const d = c.documentStats;
                const done = d.uploaded + d.verified;
                return (
                  <Tr key={c.id} onClick={() => navigate(`/onboarding/${c.id}`)}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={c.candidateName} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-zinc-900">{c.candidateName}</p>
                          <p className="truncate text-xs text-zinc-500">{c.jobTitle}</p>
                        </div>
                      </div>
                    </Td>
                    <Td className="text-xs whitespace-nowrap">
                      <p className="text-zinc-900">{fmtDate(c.joiningDate)}</p>
                      {c.joiningDate && new Date(c.joiningDate) > new Date() && <p className="text-zinc-500">{until(c.joiningDate)}</p>}
                    </Td>
                    <Td>
                      <div className="w-44">
                        <div className="mb-1 flex justify-between text-xs text-zinc-500">
                          <span>
                            {done}/{d.total} uploaded · {d.verified} verified
                          </span>
                        </div>
                        <ProgressBar value={d.total ? (done / d.total) * 100 : 0} tone={d.rejected ? 'amber' : 'green'} />
                        {d.rejected > 0 && <p className="mt-1 text-xs text-amber-600">{d.rejected} need re-upload</p>}
                      </div>
                    </Td>
                    <Td>
                      <StatusBadge value={c.status} />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={pageSize} total={list.data.total} onChange={setPage} />
        </>
      )}
    </div>
  );
}
