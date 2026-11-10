import { CheckCircle2, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { humanize, toneFor } from '@/lib/format';
import { useApiMutation } from '@/lib/hooks';
import type { Application } from '@/lib/types';
import { Badge, Button, ScoreRing } from '@/components/ui';

/** AI resume ↔ job match summary for an application. */
export function AiMatchCard({ application, canRematch }: { application: Application; canRematch?: boolean }) {
  const rematch = useApiMutation(() => api.post<Application>(`/applications/${application.id}/rematch`), {
    success: 'AI match recalculated',
    invalidate: [['applications'], ['candidates']],
  });
  const m = application.aiMatch;
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-4">
      <div className="flex items-start gap-4">
        <ScoreRing score={application.aiMatchScore} size={60} label="AI match" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-violet-600" />
            <span className="text-sm font-semibold text-zinc-900">Fit with this job</span>
            {m?.recommendation && <Badge tone={toneFor(m.recommendation)}>{humanize(m.recommendation)}</Badge>}
            {canRematch && (
              <Button size="xs" variant="ghost" className="ml-auto" loading={rematch.isPending} icon={<RefreshCw className="size-3" />} onClick={() => rematch.mutate()}>
                Rematch
              </Button>
            )}
          </div>
          {m ? (
            <p className="mt-1.5 text-sm text-zinc-600">{m.summary}</p>
          ) : (
            <p className="mt-1.5 text-sm text-zinc-500">{application.aiMatchScore === null ? 'Analysis pending — AI matching runs in the background after a resume is attached.' : ''}</p>
          )}
        </div>
      </div>
      {m && (m.strengths?.length || m.gaps?.length) ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[13px] font-semibold text-emerald-700">Strengths</p>
            <ul className="space-y-1">
              {(m.strengths ?? []).map((s, i) => (
                <li key={i} className="flex gap-2 text-sm text-zinc-700">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1.5 text-[13px] font-semibold text-amber-700">Gaps</p>
            <ul className="space-y-1">
              {(m.gaps ?? []).map((s, i) => (
                <li key={i} className="flex gap-2 text-sm text-zinc-700">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
