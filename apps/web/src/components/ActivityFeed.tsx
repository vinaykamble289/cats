import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Award,
  Briefcase,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Handshake,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Video,
  XCircle,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import { fromNow, STAGE_LABEL, humanize } from '@/lib/format';
import { useUserMap } from '@/lib/hooks';
import type { ActivityEvent, ApplicationStage } from '@/lib/types';
import { EmptyState, Spinner } from './ui';

function describe(e: ActivityEvent): { icon: ReactNode; text: ReactNode; color: string } {
  const p = e.payload ?? {};
  const who = <strong className="font-medium text-zinc-900">{p.candidateName ?? 'Candidate'}</strong>;
  const job = p.jobTitle ? <span className="text-zinc-500"> · {p.jobTitle}</span> : null;
  const stage = (s: unknown) => STAGE_LABEL[s as ApplicationStage] ?? humanize(String(s ?? ''));
  switch (e.type) {
    case 'job.created':
      return { icon: <Briefcase className="size-3.5" />, color: 'bg-zinc-100 text-zinc-500', text: <>Job <strong className="font-medium text-zinc-900">{p.title}</strong> created</> };
    case 'job.status_changed':
      return { icon: <Briefcase className="size-3.5" />, color: 'bg-zinc-100 text-zinc-500', text: <>Job <strong className="font-medium text-zinc-900">{p.title}</strong> is now {humanize(p.to)}</> };
    case 'job.filled':
      return { icon: <Award className="size-3.5" />, color: 'bg-emerald-50 text-emerald-700', text: <>Position <strong className="font-medium text-zinc-900">{p.title}</strong> filled</> };
    case 'candidate.created':
      return { icon: <UserPlus className="size-3.5" />, color: 'bg-zinc-100 text-zinc-500', text: <>{who} added{p.source ? ` via ${humanize(p.source)}` : ''}</> };
    case 'application.created':
      return { icon: <UserPlus className="size-3.5" />, color: 'bg-zinc-100 text-zinc-500', text: <>{who} applied{job}</> };
    case 'application.stage_changed':
      if (p.toStatus === 'rejected') return { icon: <XCircle className="size-3.5" />, color: 'bg-red-50 text-red-700', text: <>{who} rejected{job}</> };
      return { icon: <Activity className="size-3.5" />, color: 'bg-zinc-100 text-zinc-500', text: <>{who} moved to {stage(p.toStage)}{job}</> };
    case 'application.ai_matched':
      return { icon: <Sparkles className="size-3.5" />, color: 'bg-zinc-100 text-zinc-500', text: <>{who} AI match score {p.score}%{job}</> };
    case 'review.requested':
      return { icon: <FileText className="size-3.5" />, color: 'bg-zinc-100 text-zinc-500', text: <>Resume review requested for {who}{job}</> };
    case 'review.submitted':
      return { icon: <MessageSquare className="size-3.5" />, color: 'bg-zinc-100 text-zinc-500', text: <>Review submitted for {who}: {humanize(p.decision)}</> };
    case 'assessment.invited':
      return { icon: <ClipboardCheck className="size-3.5" />, color: 'bg-zinc-100 text-zinc-500', text: <>{who} invited to test {p.testTitle}</> };
    case 'assessment.graded':
      return {
        icon: <ClipboardCheck className="size-3.5" />,
        color: p.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
        text: <>{who} scored {p.percent}% on {p.testTitle} ({p.passed ? 'passed' : 'failed'})</>,
      };
    case 'interview.invited':
    case 'interview.scheduled':
      return { icon: <Video className="size-3.5" />, color: 'bg-zinc-100 text-zinc-500', text: <>{who} {e.type === 'interview.scheduled' ? 'scheduled for' : 'invited to'} {p.roundName}</> };
    case 'interview.evaluated':
      return {
        icon: <Video className="size-3.5" />,
        color: p.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700',
        text: <>{who} {p.roundName}: score {p.score}</>,
      };
    case 'interview.series_passed':
      return { icon: <CheckCircle2 className="size-3.5" />, color: 'bg-emerald-50 text-emerald-700', text: <>{who} cleared all interview rounds{job}</> };
    case 'offer.sent':
    case 'offer.revised':
      return { icon: <Handshake className="size-3.5" />, color: 'bg-amber-50 text-amber-700', text: <>Offer {e.type === 'offer.sent' ? 'sent to' : 'revised for'} {who}{job}</> };
    case 'offer.countered':
      return { icon: <Handshake className="size-3.5" />, color: 'bg-amber-50 text-amber-700', text: <>{who} requested changes to the offer</> };
    case 'offer.accepted':
      return { icon: <Handshake className="size-3.5" />, color: 'bg-emerald-50 text-emerald-700', text: <>{who} accepted the offer{job}</> };
    case 'offer.declined':
      return { icon: <XCircle className="size-3.5" />, color: 'bg-red-50 text-red-700', text: <>{who} declined the offer{job}</> };
    case 'onboarding.bgv_sent':
    case 'onboarding.bgv_updated':
      return { icon: <ShieldCheck className="size-3.5" />, color: 'bg-zinc-100 text-zinc-500', text: <>Background verification {e.type === 'onboarding.bgv_sent' ? 'initiated' : humanize(p.status)} for {who}</> };
    case 'onboarding.joined':
      return { icon: <Award className="size-3.5" />, color: 'bg-emerald-50 text-emerald-700', text: <>{who} joined as {p.jobTitle}</> };
    default:
      return { icon: <Activity className="size-3.5" />, color: 'bg-zinc-100 text-zinc-500', text: <>{humanize(e.type.replace('.', ' '))}{p.candidateName ? <> · {who}</> : null}</> };
  }
}

/** Timeline of domain events. Filter by candidate/job/application or show everything. */
export function ActivityFeed({ candidateId, jobId, applicationId, limit = 30, compact }: { candidateId?: string; jobId?: string; applicationId?: string; limit?: number; compact?: boolean }) {
  const users = useUserMap();
  const { data, isLoading } = useQuery({
    queryKey: ['activity', { candidateId, jobId, applicationId, limit }],
    queryFn: () => api.get<{ data: ActivityEvent[] }>('/activity', { candidateId, jobId, applicationId, limit }),
    refetchInterval: 30_000,
  });
  if (isLoading) return <div className="flex justify-center py-8"><Spinner /></div>;
  if (!data?.data.length) return <EmptyState title="No activity yet" description="Actions on candidates and jobs will appear here." />;
  return (
    <ol className="relative space-y-4">
      {data.data.map((e) => {
        const d = describe(e);
        const actor = e.actorId ? users.get(e.actorId)?.fullName : null;
        return (
          <li key={e.id} className="flex gap-3">
            <div className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${d.color}`}>{d.icon}</div>
            <div className="min-w-0 text-sm">
              <p className="text-zinc-700">{d.text}</p>
              {!compact && (
                <p className="mt-0.5 text-xs text-zinc-400">
                  {fromNow(e.createdAt)}
                  {actor ? ` · by ${actor}` : ''}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
