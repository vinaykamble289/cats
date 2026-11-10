import type { Db } from '@hireflow/shared';

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

export const PROCTOR_TYPES = Object.keys(PROCTOR_WEIGHTS);

export function integrityScore(counts: Record<string, number>): number {
  const penalty = Object.entries(counts).reduce((sum, [type, n]) => sum + (PROCTOR_WEIGHTS[type] ?? 0) * n, 0);
  return Math.max(0, Math.round(100 - penalty));
}

export async function proctorCounts(db: Db, invitationId: string): Promise<Record<string, number>> {
  const rows = await db<{ eventType: string; n: number }[]>`
    select event_type, count(*)::int as n from assessment.proctor_events where invitation_id = ${invitationId} group by event_type
  `;
  return Object.fromEntries(rows.map((r) => [r.eventType, r.n]));
}

export async function proctoringSummary(db: Db, invitationId: string) {
  const [counts, events] = await Promise.all([
    proctorCounts(db, invitationId),
    db`
      select event_type, details, occurred_at from assessment.proctor_events
      where invitation_id = ${invitationId} order by occurred_at desc limit 200
    `,
  ]);
  return { counts, events };
}
