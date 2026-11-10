import { Redis } from 'ioredis';
import { optional } from './env.js';

/**
 * Redis connections tuned for caching: never queue commands while disconnected
 * and give up quickly, so a Redis outage degrades to "no cache" instead of
 * stalling requests.
 */
export function createRedis(url: string, opts: { db?: number; name: string }): Redis {
  const client = new Redis(url, {
    db: opts.db,
    connectionName: opts.name,
    lazyConnect: false,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: Number(optional('REDIS_COMMAND_TIMEOUT_MS', '250')),
    connectTimeout: 3_000,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });
  // Errors are surfaced per command; avoid unhandled 'error' event crashes and log spam.
  let lastLog = 0;
  client.on('error', (err) => {
    if (Date.now() - lastLog > 30_000) {
      lastLog = Date.now();
      const e = err as Error & { code?: string };
      console.warn(`[redis:${opts.name}] unavailable, caching bypassed (${e.message || e.code || 'connection error'})`);
    }
  });
  return client;
}

/** Shared version store (table versions for cache invalidation). Logical db 0 of REDIS_URL. */
export const VERSION_DB = 0;
export const VERSION_KEY = 'hf:dbv';
/** Random epoch stored in the version hash; if the hash is ever lost, all old cache keys become unreachable. */
export const EPOCH_FIELD = '__epoch';

/** One logical Redis database per service cache (when they share a Redis server). */
export const CACHE_DB_INDEX: Record<string, number> = {
  identity: 1,
  jobs: 2,
  talent: 3,
  assessment: 4,
  interview: 5,
  offer: 6,
  onboarding: 7,
  notify: 8,
};
