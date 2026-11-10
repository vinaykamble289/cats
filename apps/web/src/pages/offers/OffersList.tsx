import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Handshake, Hourglass, MessageCircle, PartyPopper, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fromNow } from '@/lib/format';
import type { Offer, OfferStatus, Paginated } from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';
import { Avatar, EmptyState, ErrorState, PageHeader, PageLoader, Pagination, Segmented, StatCard, Table, Td, Th, Tr, cx } from '@/components/ui';

interface OfferStats {
  byStatus: Partial<Record<OfferStatus, number>>;
  acceptanceRate: number | null;
}

type Filter = 'all' | 'draft' | 'sent' | 'negotiating' | 'accepted' | 'closed';
const FILTER_STATUS: Record<Filter, string | undefined> = {
  all: undefined,
  draft: 'draft',
  sent: 'sent',
  negotiating: 'negotiating',
  accepted: 'accepted',
  closed: 'declined,withdrawn,expired',
};

export default function OffersList() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const stats = useQuery({ queryKey: ['offers', 'stats'], queryFn: () => api.get<OfferStats>('/offers/stats') });
  const list = useQuery({
    queryKey: ['offers', { filter, page }],
    queryFn: () => api.get<Paginated<Offer>>('/offers', { status: FILTER_STATUS[filter], page, pageSize }),
  });
  const s = stats.data?.byStatus ?? {};
  const rate = stats.data?.acceptanceRate;

  return (
    <div>
      <PageHeader title="Offers" subtitle="Create, send and negotiate offers with full version history" />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Awaiting response" value={s.sent ?? 0} icon={<Send className="size-5" />} tone="sky" />
        <StatCard label="Negotiating" value={s.negotiating ?? 0} icon={<MessageCircle className="size-5" />} tone="amber" />
        <StatCard label="Accepted" value={s.accepted ?? 0} icon={<PartyPopper className="size-5" />} tone="green" />
        <StatCard
          label="Acceptance rate"
          value={rate === null || rate === undefined ? '—' : `${Math.round(rate <= 1 ? rate * 100 : rate)}%`}
          icon={<Hourglass className="size-5" />}
          tone="violet"
        />
      </div>

      <div className="mb-4">
        <Segmented
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
          options={[
            { value: 'all', label: 'All' },
            { value: 'draft', label: 'Drafts' },
            { value: 'sent', label: 'Sent' },
            { value: 'negotiating', label: 'Negotiating' },
            { value: 'accepted', label: 'Accepted' },
            { value: 'closed', label: 'Closed' },
          ]}
        />
      </div>

      {list.isLoading ? (
        <PageLoader />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.data.length ? (
        <EmptyState icon={<Handshake className="size-5" />} title="No offers" description="Create an offer from a candidate who has cleared the interview rounds." />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Candidate</Th>
                <Th>Designation</Th>
                <Th className="text-right">CTC</Th>
                <Th>Joining</Th>
                <Th>Status</Th>
                <Th>Expires</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.data.map((o) => {
                const v = o.current;
                const expiringSoon = o.expiresAt && ['sent', 'negotiating'].includes(o.status) && new Date(o.expiresAt).getTime() - Date.now() < 2 * 86400_000;
                return (
                  <Tr key={o.id} onClick={() => navigate(`/offers/${o.id}`)}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={o.candidateName} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-zinc-900">{o.candidateName}</p>
                          <p className="truncate text-xs text-zinc-500">{o.jobTitle}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      {v?.designation ?? '—'} <span className="text-xs text-zinc-400">v{o.currentVersion}</span>
                    </Td>
                    <Td className="text-right font-medium whitespace-nowrap text-zinc-900">{v ? fmtMoney(v.baseSalary + v.variablePay, v.currency) : '—'}</Td>
                    <Td className="text-xs whitespace-nowrap">{fmtDate(v?.joiningDate)}</Td>
                    <Td>
                      <StatusBadge value={o.status} />
                    </Td>
                    <Td className={cx('text-xs whitespace-nowrap', expiringSoon && 'font-medium text-amber-600')}>{fmtDate(o.expiresAt)}</Td>
                    <Td className="text-xs whitespace-nowrap text-zinc-500">{fromNow(o.updatedAt)}</Td>
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
