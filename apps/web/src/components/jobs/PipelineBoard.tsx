import { useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Clock, MessageSquare, ThumbsDown, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { api, errorMessage } from '@/lib/api';
import { STAGES, STAGE_COLOR, STAGE_LABEL, scoreTone } from '@/lib/format';
import type { Application, ApplicationStage, Paginated } from '@/lib/types';
import { Avatar, cx } from '@/components/ui';

export function daysIn(iso: string) {
  return Math.max(0, differenceInCalendarDays(new Date(), parseISO(iso)));
}

export function ReviewChips({ s }: { s: Application['reviewSummary'] }) {
  if (!s || (!s.pending && !s.completed)) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
      {s.positive > 0 && (
        <span className="flex items-center gap-0.5 text-emerald-600">
          <ThumbsUp className="size-3" />
          {s.positive}
        </span>
      )}
      {s.negative > 0 && (
        <span className="flex items-center gap-0.5 text-red-600">
          <ThumbsDown className="size-3" />
          {s.negative}
        </span>
      )}
      {s.pending > 0 && (
        <span className="flex items-center gap-0.5">
          <MessageSquare className="size-3" />
          {s.pending} pending
        </span>
      )}
    </span>
  );
}

function ApplicationCard({
  app,
  selected,
  onToggle,
  draggable,
}: {
  app: Application;
  selected: boolean;
  onToggle: () => void;
  draggable: boolean;
}) {
  const days = daysIn(app.stageChangedAt);
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/application-id', app.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={cx(
        'group rounded-lg border bg-white p-3 shadow-xs transition',
        draggable && 'cursor-grab active:cursor-grabbing',
        selected ? 'border-brand-400 ring-2 ring-brand-500/20' : 'border-zinc-200 hover:border-zinc-300 hover:shadow-sm',
        app.status === 'on_hold' && 'opacity-70',
      )}
    >
      <div className="flex items-start gap-2.5">
        {draggable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            onClick={(e) => e.stopPropagation()}
            className={cx('mt-1 size-3.5 cursor-pointer accent-brand-600', !selected && 'opacity-0 group-hover:opacity-100')}
          />
        )}
        <Avatar name={app.candidate.fullName} size="xs" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <Link to={`/candidates/${app.candidateId}`} className="block truncate text-sm font-medium text-zinc-900 hover:text-brand-700">
            {app.candidate.fullName}
          </Link>
          <p className="truncate text-xs text-zinc-500">
            {[app.candidate.currentTitle, app.candidate.currentCompany].filter(Boolean).join(' · ') || app.candidate.email}
          </p>
        </div>
        {app.aiMatchScore !== null && (
          <span title="AI match score" className={cx('rounded-md bg-zinc-50 px-1.5 py-0.5 text-xs font-semibold', scoreTone(app.aiMatchScore))}>
            {app.aiMatchScore}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 pl-0.5">
        <ReviewChips s={app.reviewSummary} />
        <span className={cx('ml-auto flex items-center gap-1 text-[11px]', days > 7 ? 'text-amber-600' : 'text-zinc-400')} title="Days in stage">
          <Clock className="size-3" />
          {days}d
        </span>
      </div>
      {app.status === 'on_hold' && <p className="mt-1.5 text-[11px] font-medium text-amber-600">On hold</p>}
    </div>
  );
}

/** Kanban board grouped by stage with HTML5 drag & drop and optimistic stage changes. */
export function PipelineBoard({
  applications,
  queryKey,
  selected,
  setSelected,
  canEdit,
}: {
  applications: Application[];
  queryKey: QueryKey;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [over, setOver] = useState<ApplicationStage | null>(null);

  async function move(id: string, stage: ApplicationStage) {
    const prev = qc.getQueryData<Paginated<Application>>(queryKey);
    const app = prev?.data.find((a) => a.id === id);
    if (!app || app.stage === stage) return;
    qc.setQueryData<Paginated<Application>>(queryKey, (old) =>
      old ? { ...old, data: old.data.map((a) => (a.id === id ? { ...a, stage, stageChangedAt: new Date().toISOString() } : a)) } : old,
    );
    try {
      await api.post(`/applications/${id}/stage`, { stage });
      toast.success(`${app.candidate.fullName} → ${STAGE_LABEL[stage]}`);
      qc.invalidateQueries({ queryKey: ['applications'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
    } catch (err) {
      qc.setQueryData(queryKey, prev);
      toast.error(errorMessage(err));
    }
  }

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <div className="scroll-thin -mx-1 flex gap-3 overflow-x-auto px-1 pb-4">
      {STAGES.map((stage) => {
        const items = applications.filter((a) => a.stage === stage).sort((a, b) => (b.aiMatchScore ?? -1) - (a.aiMatchScore ?? -1));
        const allSelected = items.length > 0 && items.every((a) => selected.has(a.id));
        return (
          <div
            key={stage}
            onDragOver={(e) => {
              if (!canEdit) return;
              e.preventDefault();
              setOver(stage);
            }}
            onDragLeave={() => setOver((o) => (o === stage ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData('text/application-id');
              if (id && canEdit) void move(id, stage);
            }}
            className={cx('flex w-72 shrink-0 flex-col rounded-xl border bg-zinc-100/60 transition', over === stage ? 'border-brand-400 bg-brand-50/60' : 'border-transparent')}
          >
            <div className="flex items-center gap-2 px-3 pt-3 pb-2">
              <span className={cx('size-2 rounded-full', STAGE_COLOR[stage])} />
              <span className="text-sm font-semibold text-zinc-800">{STAGE_LABEL[stage]}</span>
              <span className="rounded-full bg-white px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 shadow-xs">{items.length}</span>
              {canEdit && items.length > 0 && (
                <input
                  type="checkbox"
                  title="Select all in column"
                  checked={allSelected}
                  onChange={() => {
                    const next = new Set(selected);
                    for (const a of items) allSelected ? next.delete(a.id) : next.add(a.id);
                    setSelected(next);
                  }}
                  className="ml-auto size-3.5 cursor-pointer accent-brand-600"
                />
              )}
            </div>
            <div className="scroll-thin flex max-h-[calc(100vh-330px)] min-h-32 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {items.map((a) => (
                <ApplicationCard key={a.id} app={a} selected={selected.has(a.id)} onToggle={() => toggle(a.id)} draggable={canEdit} />
              ))}
              {!items.length && <div className="rounded-lg border border-dashed border-zinc-200 py-6 text-center text-xs text-zinc-400">{canEdit ? 'Drop candidates here' : 'Empty'}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
