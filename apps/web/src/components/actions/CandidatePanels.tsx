import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronRight, ClipboardCheck, Handshake, ShieldCheck, Video } from 'lucide-react';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney, ROUND_KIND_LABEL, scoreTone } from '@/lib/format';
import type { Invitation, Offer, OnboardingCase, Paginated, Round } from '@/lib/types';
import { StatusBadge } from '../StatusBadge';
import { EmptyState, ProgressBar, Spinner, cx } from '../ui';

function Row({ to, icon, title, subtitle, right }: { to: string; icon: ReactNode; title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <Link to={to} className="group flex items-center gap-3 rounded-lg border border-zinc-200 bg-white p-3 transition hover:border-zinc-300 hover:shadow-xs">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-900">{title}</p>
        {subtitle && <p className="truncate text-xs text-zinc-500">{subtitle}</p>}
      </div>
      {right}
      <ChevronRight className="size-4 text-zinc-300 group-hover:text-zinc-500" />
    </Link>
  );
}

function Loading() {
  return (
    <div className="flex justify-center py-6">
      <Spinner />
    </div>
  );
}

export function CandidateAssessments({ candidateId }: { candidateId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['invitations', { candidateId }],
    queryFn: () => api.get<Paginated<Invitation>>('/invitations', { candidateId, pageSize: 50 }),
  });
  if (isLoading) return <Loading />;
  if (!data?.data.length) return <EmptyState icon={<ClipboardCheck className="size-5" />} title="No assessments yet" />;
  return (
    <div className="space-y-2">
      {data.data.map((inv) => (
        <Row
          key={inv.id}
          to={`/assessments/results/${inv.id}`}
          icon={<ClipboardCheck className="size-4" />}
          title={inv.testTitle}
          subtitle={inv.submittedAt ? `Submitted ${fmtDateTime(inv.submittedAt)}` : `Invited · expires ${fmtDate(inv.expiresAt)}`}
          right={
            <div className="flex items-center gap-2">
              {inv.percent !== null && <span className={cx('text-sm font-semibold', scoreTone(inv.percent))}>{Math.round(inv.percent)}%</span>}
              {inv.passed !== null ? <StatusBadge value={inv.passed ? 'accepted' : 'rejected'} label={inv.passed ? 'Passed' : 'Failed'} /> : <StatusBadge value={inv.status} />}
            </div>
          }
        />
      ))}
    </div>
  );
}

export function CandidateInterviews({ candidateId }: { candidateId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['rounds', { candidateId }],
    queryFn: () => api.get<Paginated<Round>>('/rounds', { candidateId, pageSize: 50 }),
  });
  if (isLoading) return <Loading />;
  if (!data?.data.length) return <EmptyState icon={<Video className="size-5" />} title="No interviews yet" />;
  const rounds = [...data.data].sort((a, b) => a.jobId.localeCompare(b.jobId) || a.sequence - b.sequence);
  return (
    <div className="space-y-2">
      {rounds.map((r) => (
        <Row
          key={r.id}
          to={`/interviews/${r.id}`}
          icon={<Video className="size-4" />}
          title={`${r.sequence}. ${r.name}`}
          subtitle={`${ROUND_KIND_LABEL[r.kind]} · ${r.jobTitle}${r.scheduledAt ? ` · ${fmtDateTime(r.scheduledAt)}` : ''}`}
          right={
            <div className="flex items-center gap-2">
              {r.score !== null && <span className={cx('text-sm font-semibold', scoreTone(r.score))}>{r.score}</span>}
              <StatusBadge value={r.status} />
            </div>
          }
        />
      ))}
    </div>
  );
}

export function CandidateOffers({ candidateId }: { candidateId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['offers', { candidateId }],
    queryFn: () => api.get<Paginated<Offer>>('/offers', { candidateId, pageSize: 50 }),
  });
  if (isLoading) return <Loading />;
  if (!data?.data.length) return <EmptyState icon={<Handshake className="size-5" />} title="No offers yet" />;
  return (
    <div className="space-y-2">
      {data.data.map((o) => (
        <Row
          key={o.id}
          to={`/offers/${o.id}`}
          icon={<Handshake className="size-4" />}
          title={`${o.current?.designation ?? o.jobTitle} · v${o.currentVersion}`}
          subtitle={`${fmtMoney((o.current?.baseSalary ?? 0) + (o.current?.variablePay ?? 0), o.current?.currency)} CTC${o.current?.joiningDate ? ` · joining ${fmtDate(o.current.joiningDate)}` : ''}`}
          right={<StatusBadge value={o.status} />}
        />
      ))}
    </div>
  );
}

export function CandidateOnboarding({ candidateId }: { candidateId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['onboarding', 'all'],
    queryFn: () => api.get<Paginated<OnboardingCase>>('/onboarding', { pageSize: 200 }),
  });
  if (isLoading) return <Loading />;
  const cases = (data?.data ?? []).filter((c) => c.candidateId === candidateId);
  if (!cases.length) return <EmptyState icon={<ShieldCheck className="size-5" />} title="No pre-joining case yet" description="A case is created automatically when the candidate accepts an offer." />;
  return (
    <div className="space-y-2">
      {cases.map((c) => {
        const s = c.documentStats;
        const pct = s.total ? ((s.uploaded + s.verified) / s.total) * 100 : 0;
        return (
          <Row
            key={c.id}
            to={`/onboarding/${c.id}`}
            icon={<ShieldCheck className="size-4" />}
            title={c.jobTitle}
            subtitle={
              <span className="flex items-center gap-2">
                <span>Joining {fmtDate(c.joiningDate)}</span>
                <ProgressBar value={pct} className="w-20" tone="green" />
                <span>
                  {s.uploaded + s.verified}/{s.total} docs
                </span>
              </span>
            }
            right={<StatusBadge value={c.status} />}
          />
        );
      })}
    </div>
  );
}
