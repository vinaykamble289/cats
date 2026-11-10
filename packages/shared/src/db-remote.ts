import { env, optional, serviceUrl } from './env.js';
import { AppError } from './errors.js';
import { INTERNAL_KEY_HEADER } from './service.js';
import { QueryCache } from './cache.js';
import {
  BYTEA_OID,
  isVolatileSql,
  isWriteSql,
  shapeText,
  tablesIn,
  TS_ARRAY_OIDS,
  TS_OIDS,
  type WireQuery,
  type WireResult,
  type WireValue,
} from './db-wire.js';
import type { Sql } from './db.js';

/* ------------------------------------------------------------------ Query objects (mirror postgres.js laziness) */

type Exec = (q: RemoteQuery) => Promise<unknown[]>;

/** A tagged-template query. Runs only when awaited; when embedded in another query it acts as a fragment. */
class RemoteQuery implements PromiseLike<unknown[]> {
  private p?: Promise<unknown[]>;
  constructor(
    readonly strings: readonly string[],
    readonly values: unknown[],
    private readonly exec: Exec,
  ) {}
  private run() {
    return (this.p ??= this.exec(this));
  }
  then<A = unknown[], B = never>(ok?: ((v: unknown[]) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    return this.run().then(ok, fail);
  }
  catch<B = never>(fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return this.run().catch(fail);
  }
  finally(fn?: (() => void) | null) {
    return this.run().finally(fn);
  }
}

class Helper {
  constructor(
    readonly first: unknown,
    readonly columns: string[],
  ) {}
}
class JsonParam {
  constructor(readonly value: unknown) {}
}
class ArrayParam {
  constructor(
    readonly value: unknown[],
    readonly type?: number,
  ) {}
}

/* ------------------------------------------------------------------ Encoding */

function encodeQuery(q: RemoteQuery): WireQuery {
  return { s: [...q.strings], v: q.values.map(encodeValue) };
}

function encodeValue(x: unknown): WireValue {
  if (x === undefined) throw new AppError(500, 'Undefined value passed to SQL query (use null)', 'UNDEFINED_VALUE');
  if (x === null || typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') return x;
  if (typeof x === 'bigint') return { $: 'n', v: x.toString() };
  if (x instanceof Date) return { $: 'd', v: x.toISOString() };
  if (x instanceof RemoteQuery) return { $: 'q', q: encodeQuery(x) };
  if (x instanceof Helper) return { $: 'h', f: encodeValue(x.first), c: x.columns };
  if (x instanceof JsonParam) return { $: 'j', v: x.value === undefined ? null : JSON.parse(JSON.stringify(x.value)) };
  if (x instanceof ArrayParam) return { $: 'a', v: x.value.map(encodeValue), t: x.type };
  if (x instanceof Uint8Array) return { $: 'b', v: Buffer.from(x).toString('base64') };
  if (Array.isArray(x)) return { $: 'l', v: x.map(encodeValue) };
  if (typeof x === 'object') {
    const v: Record<string, WireValue> = {};
    for (const [k, val] of Object.entries(x as Record<string, unknown>)) if (val !== undefined) v[k] = encodeValue(val);
    return { $: 'o', v };
  }
  throw new AppError(500, `Unsupported SQL value of type ${typeof x}`, 'UNSUPPORTED_VALUE');
}

/* ------------------------------------------------------------------ Results & errors */

function revive(res: WireResult): unknown[] {
  const dates = res.cols.filter(([, t]) => TS_OIDS.has(t)).map(([n]) => n);
  const dateArrays = res.cols.filter(([, t]) => TS_ARRAY_OIDS.has(t)).map(([n]) => n);
  const bytes = res.cols.filter(([, t]) => t === BYTEA_OID).map(([n]) => n);
  if (dates.length || dateArrays.length || bytes.length) {
    for (const row of res.rows) {
      for (const c of dates) if (typeof row[c] === 'string') row[c] = new Date(row[c] as string);
      for (const c of dateArrays) if (Array.isArray(row[c])) row[c] = (row[c] as (string | null)[]).map((v) => (v === null ? null : new Date(v)));
      for (const c of bytes) {
        const b = row[c] as { data?: number[] } | null;
        if (b && Array.isArray(b.data)) row[c] = Buffer.from(b.data);
      }
    }
  }
  const out = res.rows as unknown[] & { count?: number | null; command?: string | null };
  Object.defineProperties(out, {
    count: { value: res.count, writable: true },
    command: { value: res.command, writable: true },
  });
  return out;
}

/** Mirrors postgres.js PostgresError so existing handlers (`err.code === '23505'`, error middleware) keep working. */
export class RemotePostgresError extends Error {
  override name = 'PostgresError';
  [k: string]: unknown;
  constructor(fields: Record<string, unknown>) {
    super(String(fields.message ?? 'Database error'));
    Object.assign(this, fields);
  }
}

interface ExecResponse {
  result?: WireResult;
  tx?: string;
  error?: { code?: string; message?: string; pg?: Record<string, unknown>; txClosed?: boolean };
}

class DbClient {
  private readonly base = serviceUrl('db');
  private readonly timeout = Number(optional('DB_CLIENT_TIMEOUT_MS', '30000'));

  constructor(readonly schema: string) {}

  async post(path: string, body: unknown, opts: { retry?: boolean } = {}): Promise<ExecResponse> {
    const attempts = opts.retry ? 3 : 1;
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      if (i) await new Promise((r) => setTimeout(r, 50 * 2 ** i));
      let res: Response;
      try {
        res = await fetch(this.base + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json', [INTERNAL_KEY_HEADER]: env.internalApiKey(), 'x-db-schema': this.schema },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeout),
        });
      } catch (err) {
        last = err; // network error: only safe to retry for reads
        continue;
      }
      const data = (await res.json().catch(() => ({}))) as ExecResponse;
      if (res.ok) return data;
      if (res.status === 503 && opts.retry) {
        last = new AppError(503, data.error?.message ?? 'Database is busy', data.error?.code ?? 'DB_BUSY');
        continue;
      }
      throw toError(res.status, data);
    }
    throw last instanceof AppError ? last : new AppError(503, 'Database service is unavailable', 'DB_UNAVAILABLE', String(last));
  }
}

function toError(status: number, data: ExecResponse): Error {
  const e = data.error ?? {};
  if (e.pg) return new RemotePostgresError(e.pg);
  return new AppError(status >= 500 ? 503 : status, e.message ?? `Database service error (${status})`, e.code ?? 'DB_ERROR');
}

/* ------------------------------------------------------------------ Sql factory */

function makeSqlFn(exec: Exec) {
  const fn = (first: unknown, ...rest: unknown[]) => {
    if (first && Array.isArray((first as { raw?: unknown }).raw)) return new RemoteQuery(first as readonly string[], rest, exec);
    return new Helper(first, rest.flat() as string[]);
  };
  return Object.assign(fn, {
    json: (value: unknown) => new JsonParam(value),
    array: (value: unknown[], type?: number) => new ArrayParam(value, type),
  });
}

class RemoteTx {
  private id: Promise<string> | null = null;
  private dead: Error | null = null;
  readonly sql;

  constructor(private readonly client: DbClient) {
    const sql = makeSqlFn((q) => this.exec(q));
    this.sql = Object.assign(sql, {
      savepoint: () => {
        throw new AppError(500, 'Savepoints are not supported through the DB service', 'NOT_SUPPORTED');
      },
    });
  }

  private async exec(q: RemoteQuery): Promise<unknown[]> {
    if (this.dead) throw this.dead;
    const wire = encodeQuery(q);
    if (!this.id) {
      // Lazy BEGIN: the first statement opens the transaction in the same round trip.
      let resolveId!: (id: string) => void;
      let rejectId!: (e: unknown) => void;
      this.id = new Promise<string>((a, b) => ((resolveId = a), (rejectId = b)));
      this.id.catch(() => {});
      try {
        const res = await this.client.post('/internal/db/query', { q: wire, begin: true });
        resolveId(res.tx!);
        return revive(res.result!);
      } catch (err) {
        this.dead = err as Error;
        rejectId(err);
        throw err;
      }
    }
    const tx = await this.id;
    try {
      const res = await this.client.post('/internal/db/query', { q: wire, tx });
      return revive(res.result!);
    } catch (err) {
      // Any failed statement aborts a Postgres transaction; the DB service has already rolled it back.
      this.dead = err as Error;
      throw err;
    }
  }

  async commit(): Promise<void> {
    if (!this.id) return; // no statements were run
    if (this.dead) throw this.dead;
    const tx = await this.id;
    await this.client.post(`/internal/db/tx/${tx}/commit`, {});
  }

  async rollback(): Promise<void> {
    if (!this.id || this.dead) return;
    const tx = await this.id.catch(() => null);
    if (tx) await this.client.post(`/internal/db/tx/${tx}/rollback`, {}).catch(() => {});
  }
}

/**
 * postgres.js-compatible `Sql` that runs every statement through the central DB service.
 * Supports: tagged templates, nested fragments, `sql(obj | obj[] | string[], ...cols)` helpers,
 * `sql.json`, `sql.array`, `sql.begin(fn)`, `result.count`. Reads outside transactions
 * go through the per-service Redis cache.
 */
export function createRemoteDb(schema: string): Sql {
  const client = new DbClient(schema);
  const cache = QueryCache.fromEnv(schema);

  const exec: Exec = async (q) => {
    const wire = encodeQuery(q);
    const text = shapeText(wire);
    if (!isWriteSql(text)) {
      const load = async () => (await client.post('/internal/db/query', { q: wire }, { retry: true })).result!;
      const tables = tablesIn(text);
      if (cache && tables.length && !isVolatileSql(text)) return revive(await cache.read(wire, tables, load));
      return revive(await load());
    }
    return revive((await client.post('/internal/db/query', { q: wire })).result!);
  };

  const sql = makeSqlFn(exec);
  return Object.assign(sql, {
    async begin(a: unknown, b?: unknown) {
      const fn = (typeof a === 'function' ? a : b) as (tx: unknown) => Promise<unknown>;
      const tx = new RemoteTx(client);
      let result: unknown;
      try {
        result = await fn(tx.sql);
        // postgres.js awaits arrays of queries returned from the callback
        if (Array.isArray(result)) result = await Promise.all(result);
      } catch (err) {
        await tx.rollback();
        throw err;
      }
      await tx.commit();
      return result;
    },
    unsafe: () => {
      throw new AppError(500, 'sql.unsafe is not supported through the DB service', 'NOT_SUPPORTED');
    },
    async end() {
      await cache?.close();
    },
    cacheStats: () => cache?.stats ?? null,
  }) as unknown as Sql;
}
