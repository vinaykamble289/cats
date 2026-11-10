import { env, serviceUrl, type ServiceName } from './env.js';
import { AppError } from './errors.js';
import { INTERNAL_KEY_HEADER, USER_HEADERS } from './service.js';
import type { AuthUser } from './types.js';

export interface CallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Forward the end user so the callee can attribute actions. */
  user?: AuthUser;
  timeoutMs?: number;
  query?: Record<string, string | number | boolean | undefined | null>;
}

/**
 * Typed service-to-service HTTP call authenticated with the internal key.
 * GETs are retried once on network failure. Non-2xx responses become AppErrors
 * carrying the callee's status (5xx are reported as 502).
 */
export async function callService<T = unknown>(service: ServiceName, path: string, opts: CallOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const url = new URL(serviceUrl(service) + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));

  const headers: Record<string, string> = { [INTERNAL_KEY_HEADER]: env.internalApiKey(), accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.user) {
    headers[USER_HEADERS.id] = opts.user.id;
    headers[USER_HEADERS.email] = opts.user.email;
    headers[USER_HEADERS.role] = opts.user.role;
    headers[USER_HEADERS.name] = encodeURIComponent(opts.user.name);
  }

  const attempts = method === 'GET' ? 2 : 1;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      });
    } catch (err) {
      lastErr = err;
      continue;
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? safeJson(text) : undefined;
    if (!res.ok) {
      const e = (data as { error?: { code?: string; message?: string } } | undefined)?.error;
      throw new AppError(res.status >= 500 ? 502 : res.status, e?.message ?? `${service} service error (${res.status})`, e?.code ?? 'UPSTREAM_ERROR');
    }
    return data as T;
  }
  throw new AppError(503, `${service} service is unavailable`, 'SERVICE_UNAVAILABLE', String(lastErr));
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
