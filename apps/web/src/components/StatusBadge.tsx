import { humanize, STAGE_COLOR, STAGE_LABEL, toneFor } from '@/lib/format';
import type { ApplicationStage } from '@/lib/types';
import { Badge, cx } from './ui';

/** Generic status badge: color derived from the value. */
export function StatusBadge({ value, label }: { value: string | null | undefined; label?: string }) {
  if (!value) return null;
  return (
    <Badge tone={toneFor(value)} dot>
      {label ?? humanize(value)}
    </Badge>
  );
}

export function StageBadge({ stage, className }: { stage: ApplicationStage; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-zinc-700', className)}>
      <span className={cx('size-1.5 rounded-full', STAGE_COLOR[stage])} />
      {STAGE_LABEL[stage]}
    </span>
  );
}
