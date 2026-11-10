import { supabase } from './supabase';

const BASE = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined | null | string[]>;

function buildUrl(path: string, query?: Query) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return url.toString();
}

async function request<T>(method: string, path: string, opts: { body?: unknown; query?: Query; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const isForm = opts.body instanceof FormData;
  if (opts.body !== undefined && !isForm) headers['content-type'] = 'application/json';
  if (opts.auth !== false) {
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.authorization = `Bearer ${data.session.access_token}`;
  }
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: any = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (!res.ok) {
    if (res.status === 401 && opts.auth !== false) {
      // session expired or revoked
      await supabase.auth.signOut();
    }
    throw new ApiError(res.status, data?.error?.message ?? `Request failed (${res.status})`, data?.error?.code, data?.error?.details);
  }
  return data as T;
}

/** Authenticated HR API: paths are relative to /api (e.g. api.get('/jobs')). */
export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', `/api${path}`, { query }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', `/api${path}`, { body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', `/api${path}`, { body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', `/api${path}`, { body: body ?? {} }),
  delete: <T = void>(path: string) => request<T>('DELETE', `/api${path}`),
  upload: <T>(path: string, form: FormData) => request<T>('POST', `/api${path}`, { body: form }),
};

/** Candidate-facing API (no login): paths are relative to /api/public. */
export const publicApi = {
  get: <T>(path: string, query?: Query) => request<T>('GET', `/api/public${path}`, { query, auth: false }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', `/api/public${path}`, { body: body ?? {}, auth: false }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', `/api/public${path}`, { body: body ?? {}, auth: false }),
  upload: <T>(path: string, form: FormData) => request<T>('POST', `/api/public${path}`, { body: form, auth: false }),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
