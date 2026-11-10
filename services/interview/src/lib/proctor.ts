import type { Db } from '@hireflow/shared';

/** Penalty per occurrence, used to compute the 0-100 integrity score. Same weights as assessment-service. */
export const PROCTOR_WEIGHTS: Record<string, number> = {
  tab_hidden: 8,
  window_blur: 4,
  fullscreen_exit: 8,
  paste: 10,
  copy: 3,
  right_click: 1,
  camera_denied: 25,
  camera_off: 10,
  multiple_displays: 15,
};

export const PROCTOR_EVENT_TYPES = Object.keys(PROCTOR_WEIGHTS) as [string, ...string[]];

export function integrityFromCounts(counts: Record<string, number>): number {
  const penalty = Object.entries(counts).reduce((sum, [type, n]) => sum + (PROCTOR_WEIGHTS[type] ?? 0) * n, 0);
  return Math.max(0, Math.round(100 - penalty));
}

export async function proctorSummary(db: Db, roundId: string) {
  const counts = await db<{ eventType: string; count: number }[]>`
    select event_type, count(*)::int as count from interview.proctor_events where round_id = ${roundId} group by event_type
  `;
  const events = await db`
    select event_type, details, occurred_at from interview.proctor_events
    where round_id = ${roundId} order by occurred_at desc limit 200
  `;
  return { counts: Object.fromEntries(counts.map((c) => [c.eventType, c.count])) as Record<string, number>, events };
}
