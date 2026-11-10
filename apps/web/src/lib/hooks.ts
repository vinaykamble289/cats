import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from './api';
import type { Department, Job, Paginated, User } from './types';

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** All users (team directory) - cached, used for reviewer/interviewer pickers and name lookups. */
export function useUsers() {
  return useQuery({
    queryKey: ['users', 'all'],
    queryFn: () => api.get<Paginated<User>>('/users', { pageSize: 200 }),
    staleTime: 5 * 60_000,
    select: (r) => r.data,
  });
}

/** id -> user lookup map */
export function useUserMap() {
  const { data } = useUsers();
  return useMemo(() => new Map((data ?? []).map((u) => [u.id, u])), [data]);
}

export function useDepartments() {
  return useQuery({
    queryKey: ['departments'],
    queryFn: () => api.get<Paginated<Department>>('/departments'),
    staleTime: 5 * 60_000,
    select: (r) => r.data,
  });
}

/** All jobs (light list) for pickers and id -> title lookups. */
export function useJobs() {
  return useQuery({
    queryKey: ['jobs', 'all'],
    queryFn: () => api.get<Paginated<Job>>('/jobs', { pageSize: 200 }),
    staleTime: 60_000,
    select: (r) => r.data,
  });
}

export function useJobMap() {
  const { data } = useJobs();
  return useMemo(() => new Map((data ?? []).map((j) => [j.id, j])), [data]);
}

/**
 * Mutation helper with toast feedback + query invalidation.
 * Usage: const m = useApiMutation((body) => api.post('/x', body), { success: 'Saved', invalidate: [['x']] })
 */
export function useApiMutation<TVars = void, TRes = unknown>(
  fn: (vars: TVars) => Promise<TRes>,
  opts: { success?: string | ((res: TRes) => string); invalidate?: QueryKey[]; onSuccess?: (res: TRes, vars: TVars) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (res, vars) => {
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(res) : opts.success);
      for (const key of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: key });
      opts.onSuccess?.(res, vars);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}
