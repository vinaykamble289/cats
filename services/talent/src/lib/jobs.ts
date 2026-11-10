import { callService, notFound, type JobContext } from '@hireflow/shared';

/** Fetches a job from jobs-service; throws 404 when missing. */
export function getJob(id: string): Promise<JobContext> {
  return callService<JobContext>('jobs', `/internal/jobs/${id}`).catch((err) => {
    if (err?.statusCode === 404) throw notFound('Job');
    throw err;
  });
}

/** Per-request memoized job lookup that never throws (null when unavailable). Used for event payloads. */
export function jobLookup() {
  const cache = new Map<string, Promise<JobContext | null>>();
  return (id: string): Promise<JobContext | null> => {
    let hit = cache.get(id);
    if (!hit) {
      hit = callService<JobContext>('jobs', `/internal/jobs/${id}`).catch(() => null);
      cache.set(id, hit);
    }
    return hit;
  };
}

/** Resolves titles for many job ids at once (best effort). */
export async function jobTitles(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  const map = new Map<string, string>();
  if (!unique.length) return map;
  try {
    const rows = await callService<{ id: string; title: string }[]>('jobs', '/internal/jobs', { query: { ids: unique.join(',') } });
    for (const r of rows) map.set(r.id, r.title);
  } catch {
    /* titles are cosmetic */
  }
  return map;
}
