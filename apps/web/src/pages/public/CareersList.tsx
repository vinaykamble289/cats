import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, Briefcase, Clock, MapPin } from 'lucide-react';
import { publicApi } from '@/lib/api';
import { COMPANY_NAME, fromNow } from '@/lib/format';
import { PortalShell } from '@/components/layout/PortalShell';
import { EmptyState, ErrorState, PageLoader, SearchInput, Segmented } from '@/components/ui';
import { EMPLOYMENT_LABEL, WORK_MODE_LABEL, experienceLabel, skillName, type PublicJob } from '@/components/portal/jobs';

export default function CareersList() {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'all' | 'remote' | 'hybrid' | 'onsite'>('all');
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['public', 'careers'], queryFn: () => publicApi.get<{ data: PublicJob[]; total: number }>('/careers') });

  const jobs = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.data ?? []).filter(
      (j) =>
        (mode === 'all' || j.workMode === mode) &&
        (!term || j.title.toLowerCase().includes(term) || (j.location ?? '').toLowerCase().includes(term) || j.skills.some((s) => skillName(s).toLowerCase().includes(term))),
    );
  }, [data, q, mode]);

  return (
    <PortalShell wide>
      <div className="mb-12 max-w-2xl">
        <p className="text-sm font-medium text-brand-700">Careers at {COMPANY_NAME}</p>
        <h1 className="font-display mt-3 text-4xl leading-[1.1] font-normal text-zinc-900 sm:text-5xl">Come build something you're proud of.</h1>
        <p className="mt-4 text-[17px] leading-relaxed text-zinc-600">Browse our open roles and apply in a couple of minutes. A real person on our team reads every application.</p>
      </div>

      <div className="mb-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={q} onChange={setQ} placeholder="Search by role, skill or location" className="sm:w-96" />
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'all', label: 'All' },
            { value: 'remote', label: 'Remote' },
            { value: 'hybrid', label: 'Hybrid' },
            { value: 'onsite', label: 'On-site' },
          ]}
        />
      </div>

      {isLoading ? (
        <PageLoader />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !jobs.length ? (
        <EmptyState icon={<Briefcase className="size-5" />} title={data?.data.length ? 'No roles match your search' : 'No open roles right now'} description="Check back soon — we're growing." />
      ) : (
        <div>
          <p className="mb-2 text-sm text-zinc-500">
            {jobs.length} open {jobs.length === 1 ? 'role' : 'roles'}
          </p>
          <div className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white">
          {jobs.map((j) => {
            const exp = experienceLabel(j.experienceMin, j.experienceMax);
            return (
              <Link key={j.id} to={`/careers/${j.slug}`} className="group flex items-center gap-4 px-5 py-5 transition-colors hover:bg-zinc-50 sm:px-6">
                <div className="min-w-0 flex-1">
                <h2 className="text-[17px] font-semibold text-zinc-900 group-hover:text-brand-700">{j.title}</h2>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-zinc-500">
                  {j.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="size-3.5" /> {j.location}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Briefcase className="size-3.5" /> {EMPLOYMENT_LABEL[j.employmentType] ?? j.employmentType} · {WORK_MODE_LABEL[j.workMode] ?? j.workMode}
                  </span>
                  {exp && (
                    <span className="flex items-center gap-1">
                      <Clock className="size-3.5" /> {exp}
                    </span>
                  )}
                </div>
                {j.skills.length > 0 && (
                  <div className="mt-3 hidden flex-wrap gap-1.5 sm:flex">
                    {j.skills.slice(0, 5).map((s) => (
                      <span key={skillName(s)} className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                        {skillName(s)}
                      </span>
                    ))}
                  </div>
                )}
                </div>
                {j.publishedAt && <p className="hidden shrink-0 text-[13px] text-zinc-400 md:block">Posted {fromNow(j.publishedAt)}</p>}
                <ArrowRight className="size-5 shrink-0 text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600" />
              </Link>
            );
          })}
          </div>
        </div>
      )}
    </PortalShell>
  );
}
