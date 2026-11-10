import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { fmtTime, humanize } from '@/lib/format';
import type { ProctoringSummary } from '@/lib/types';
import { Card, CardHeader, ScoreRing } from '../ui';

const EVENT_LABEL: Record<string, string> = {
  tab_hidden: 'Switched tab / minimised',
  window_blur: 'Window lost focus',
  fullscreen_exit: 'Exited full-screen',
  copy: 'Copied text',
  paste: 'Pasted text',
  right_click: 'Right-click',
  camera_denied: 'Camera permission denied',
  camera_off: 'Camera turned off',
  multiple_displays: 'Multiple displays detected',
};

/** Integrity score + proctoring event counts + timeline. Shared by assessments and interviews. */
export function ProctoringPanel({ integrityScore, proctoring }: { integrityScore: number | null; proctoring: ProctoringSummary | undefined }) {
  const counts = Object.entries(proctoring?.counts ?? {}).filter(([, n]) => n > 0);
  const events = proctoring?.events ?? [];
  return (
    <Card>
      <CardHeader title="Integrity & proctoring" subtitle="Browser signals captured during the session" />
      <div className="flex items-center gap-4">
        <ScoreRing score={integrityScore} label="Integrity" />
        <div className="text-sm text-zinc-600">
          {integrityScore === null ? (
            'No proctoring data.'
          ) : counts.length ? (
            <span className="flex items-center gap-1.5 text-amber-700">
              <AlertTriangle className="size-4" /> {events.length} flagged event{events.length === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-emerald-700">
              <ShieldCheck className="size-4" /> No violations detected
            </span>
          )}
        </div>
      </div>
      {counts.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {counts.map(([type, n]) => (
            <span key={type} className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
              {EVENT_LABEL[type] ?? humanize(type)} × {n}
            </span>
          ))}
        </div>
      )}
      {events.length > 0 && (
        <ol className="mt-4 max-h-64 space-y-1.5 overflow-y-auto border-l border-zinc-200 pl-4">
          {events.map((e, i) => (
            <li key={i} className="relative text-xs text-zinc-600">
              <span className="absolute top-1.5 -left-[19px] size-1.5 rounded-full bg-amber-400" />
              <span className="font-mono text-zinc-400">{fmtTime(e.occurredAt)}</span> · {EVENT_LABEL[e.eventType] ?? humanize(e.eventType)}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
