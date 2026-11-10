import postgres from 'postgres';
import { optional, required } from './env.js';
import { createRemoteDb } from './db-remote.js';

export type Sql = postgres.Sql<Record<string, unknown>>;
export type Tx = postgres.TransactionSql<Record<string, unknown>>;
/** Either the pool or a transaction - use for helpers that may run inside sql.begin(). */
export type Db = Sql | Tx;

/**
 * Returns the database handle for a service.
 *
 * Default (`DB_MODE=remote`): a postgres.js-compatible client that sends every
 * statement to the central DB service, which owns the only connection(s) to
 * Supabase. Reads outside transactions are served from the service's Redis cache
 * when possible. Call sites are unchanged: tagged templates, fragments,
 * `sql(obj)` helpers, `sql.json`, `sql.array` and `sql.begin` all work.
 *
 * `DB_MODE=direct` restores a per-service pool (useful for one-off scripts or
 * debugging) and should not be used in production.
 *
 * Always schema-qualify table names (e.g. `jobs.jobs`) - caching, invalidation
 * and the DB service's schema guard rely on it.
 */
export function createDb(schema: string): Sql {
  if (optional('DB_MODE', 'remote') === 'direct') {
    return createDirectDb(optional(`${schema.toUpperCase()}_DATABASE_URL`) || required('DATABASE_URL'), Number(optional('DB_POOL_MAX', '2')));
  }
  return createRemoteDb(schema);
}

/**
 * A real connection pool. Used by the central DB service (and DB_MODE=direct).
 * - Column names are converted snake_case <-> camelCase automatically.
 * - numeric/bigint are parsed to JS numbers, `date` columns stay 'YYYY-MM-DD' strings.
 */
export function createDirectDb(url: string, max: number, opts: { idleTimeoutSec?: number } = {}): Sql {
  return postgres(url, {
    max,
    idle_timeout: opts.idleTimeoutSec ?? 30,
    connect_timeout: 15,
    max_lifetime: 60 * 30,
    prepare: false, // compatible with Supabase poolers (transaction & session mode)
    transform: postgres.camel,
    onnotice: () => {},
    types: {
      numeric: {
        to: 1700,
        from: [1700],
        serialize: (x: unknown) => String(x),
        parse: (x: string) => Number(x),
      },
      bigint: {
        to: 20,
        from: [20],
        serialize: (x: unknown) => String(x),
        parse: (x: string) => Number(x),
      },
      date: {
        to: 1082,
        from: [1082],
        serialize: (x: unknown) => (x instanceof Date ? x.toISOString().slice(0, 10) : String(x)),
        parse: (x: string) => x,
      },
    },
  }) as unknown as Sql;
}

/** Removes keys whose value is `undefined` so `sql(obj)` only updates provided columns. */
export function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}
