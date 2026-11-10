import { callService, type JobContext } from '@hireflow/shared';

/** Per-request memoized job lookup (null when unavailable). */
export function jobLookup() {
  const cache = new Map<string, Promise<JobContext | null>>();
  return (id: string | null | undefined): Promise<JobContext | null> => {
    if (!id) return Promise.resolve(null);
    let hit = cache.get(id);
    if (!hit) {
      hit = callService<JobContext>('jobs', `/internal/jobs/${id}`).catch(() => null);
      cache.set(id, hit);
    }
    return hit;
  };
}
