import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import {
  AppError,
  createDirectDb,
  createRedis,
  isWriteSql,
  optional,
  required,
  shapeText,
  tablesIn,
  VERSION_DB,
  VERSION_KEY,
  type WireQuery,
  type WireResult,
  type WireValue,
} from '@hireflow/shared';

/* ------------------------------------------------------------------ Config */
export const cfg = {
  /** Connections to Supabase. 1 = everything shares a single connection (pipelined). */
  poolMax: Math.max(1, Number(optional('DB_POOL_MAX', '1'))),
  /** Reads in flight at once; postgres.js pipelines them over the connection(s). */
  readConcurrency: Number(optional('DB_READ_CONCURRENCY', '32')),
  /** Total waiting operations before callers get 503 DB_BUSY (backpressure). */
  queueMax: Number(optional('DB_QUEUE_MAX', '2000')),
  /** Max time an operation may wait in the queue before it is rejected (never executed). */
  queueTimeoutMs: Number(optional('DB_QUEUE_TIMEOUT_MS', '15000')),
  /** Max autocommit writes group-committed in one transaction. */
  batchMax: Number(optional('DB_BATCH_MAX', '50')),
  /** Extra wait to collect writes into a batch. 0 = batch only what is already queued (no added latency). */
  batchWindowMs: Number(optional('DB_BATCH_WINDOW_MS', '0')),
  /** A remote transaction with no activity for this long is rolled back. */
  txIdleMs: Number(optional('DB_TX_IDLE_TIMEOUT_MS', '10000')),
  /** Hard limit on a remote transaction's lifetime. */
  txMaxMs: Number(optional('DB_TX_MAX_MS', '60000')),
  /** enforce | warn | off — each service may only touch its own schema (+ platform.events). */
  guard: optional('DB_SCHEMA_GUARD', 'enforce'),
};

export const pool = createDirectDb(required('DATABASE_URL'), cfg.poolMax, { idleTimeoutSec: 0 });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySql = any;

export const stats = {
  reads: 0,
  writes: 0,
  batches: 0,
  batchedWrites: 0,
  batchFallbacks: 0,
  txOpened: 0,
  txCommitted: 0,
  txRolledBack: 0,
  txExpired: 0,
  rejectedBusy: 0,
  rejectedTimeout: 0,
  versionBumps: 0,
  versionBumpErrors: 0,
};

/* ------------------------------------------------------------------ Gate (semaphore with bounded, timed queue) */
class Gate {
  active = 0;
  private waiting: { resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout }[] = [];
  constructor(private readonly limit: number) {}

  get queued() {
    return this.waiting.length;
  }

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    assertCapacity();
    await new Promise<void>((resolve, reject) => {
      const w = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiting = this.waiting.filter((x) => x !== w);
          stats.rejectedTimeout++;
          reject(new AppError(503, 'Timed out waiting for the database', 'DB_QUEUE_TIMEOUT'));
        }, cfg.queueTimeoutMs),
      };
      this.waiting.push(w);
    });
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve(); // hand the slot over directly
    } else this.active--;
  }
}

const readGate = new Gate(cfg.readConcurrency);
const txGate = new Gate(cfg.poolMax); // never hold more transactions than connections

export function queueDepth() {
  return { reads: readGate.queued, writes: writeQueue.length, transactions: txGate.queued };
}

function assertCapacity() {
  const d = queueDepth();
  if (d.reads + d.writes + d.transactions >= cfg.queueMax) {
    stats.rejectedBusy++;
    throw new AppError(503, 'The database is busy, please retry shortly', 'DB_BUSY');
  }
}

/* ------------------------------------------------------------------ Rebuilding postgres.js calls */
export function validateWire(q: unknown): asserts q is WireQuery {
  const w = q as WireQuery;
  if (!w || !Array.isArray(w.s) || !Array.isArray(w.v) || w.s.length !== w.v.length + 1 || !w.s.every((x) => typeof x === 'string')) {
    throw new AppError(400, 'Malformed query payload', 'BAD_QUERY');
  }
}

function build(sqlx: AnySql, q: WireQuery): Promise<unknown> {
  validateWire(q);
  const strings = Object.assign([...q.s], { raw: [...q.s] });
  return sqlx(strings, ...q.v.map((v) => decode(sqlx, v)));
}

function decode(sqlx: AnySql, v: WireValue): unknown {
  if (v === null || typeof v !== 'object') return v;
  switch (v.$) {
    case 'd':
      return new Date(v.v);
    case 'n':
      return BigInt(v.v);
    case 'b':
      return Buffer.from(v.v, 'base64');
    case 'j':
      return sqlx.json(v.v);
    case 'a':
      return sqlx.array(
        v.v.map((x) => decode(sqlx, x)),
        v.t,
      );
    case 'l':
      return v.v.map((x) => decode(sqlx, x));
    case 'o':
      return Object.fromEntries(Object.entries(v.v).map(([k, x]) => [k, decode(sqlx, x)]));
    case 'q':
      return build(sqlx, v.q);
    case 'h':
      return sqlx(decode(sqlx, v.f), ...v.c);
    default:
      throw new AppError(400, 'Unknown value tag in query payload', 'BAD_QUERY');
  }
}

function encodeResult(r: unknown): WireResult {
  const res = r as unknown[] & { columns?: { name: string; type: number }[] | null; count?: number | null; command?: string | null };
  return {
    rows: [...res] as Record<string, unknown>[],
    cols: (res.columns ?? []).map((c) => [c.name, c.type] as [string, number]),
    count: res.count ?? null,
    command: res.command ?? null,
  };
}

/* ------------------------------------------------------------------ Schema guard */
export function guard(schema: string, text: string, write: boolean, log: FastifyBaseLogger): void {
  if (cfg.guard === 'off') return;
  const violations = tablesIn(text).filter((t) => {
    const [s] = t.split('.');
    if (s === schema) return false;
    if (t === 'platform.events') return !write && schema !== 'notify'; // everyone appends events; only notify reads the feed
    return true;
  });
  if (!violations.length) return;
  const msg = `Schema guard: the ${schema} service may not access ${violations.join(', ')}`;
  if (cfg.guard === 'enforce') throw new AppError(403, msg, 'SCHEMA_FORBIDDEN');
  log.warn(msg);
}

/* ------------------------------------------------------------------ Cache invalidation (table versions) */
const versions = optional('REDIS_URL') ? createRedis(optional('REDIS_URL'), { db: VERSION_DB, name: 'db-versions' }) : null;
/** parent table -> child tables changed by ON DELETE/UPDATE CASCADE / SET NULL / SET DEFAULT */
let cascades = new Map<string, string[]>();

export async function loadCascades(log: FastifyBaseLogger): Promise<void> {
  try {
    const rows = (await pool`
      select conrelid::regclass::text as child, confrelid::regclass::text as parent
      from pg_constraint
      where contype = 'f' and (confdeltype in ('c', 'n', 'd') or confupdtype in ('c', 'n', 'd'))`) as unknown as { child: string; parent: string }[];
    const map = new Map<string, string[]>();
    for (const r of rows) map.set(r.parent, [...(map.get(r.parent) ?? []), r.child]);
    cascades = map;
    log.info({ relations: rows.length }, 'Loaded cascading foreign keys for cache invalidation');
  } catch (err) {
    log.error({ err }, 'Could not load foreign keys; cascaded deletes will rely on cache TTL');
  }
}

function withCascades(tables: Iterable<string>): string[] {
  const out = new Set<string>();
  const stack = [...tables];
  while (stack.length) {
    const t = stack.pop()!;
    if (out.has(t)) continue;
    out.add(t);
    stack.push(...(cascades.get(t) ?? []));
  }
  return [...out];
}

/** Bump versions *after* commit and *before* replying, so the caller's next read can't hit a stale entry. */
async function bump(tables: Iterable<string>, log: FastifyBaseLogger, attempt = 0): Promise<void> {
  if (!versions) return;
  const all = withCascades(tables);
  if (!all.length) return;
  try {
    const m = versions.multi();
    for (const t of all) m.hincrby(VERSION_KEY, t, 1);
    await m.exec();
    stats.versionBumps++;
  } catch (err) {
    stats.versionBumpErrors++;
    if (attempt < 3) setTimeout(() => void bump(all, log, attempt + 1), 200 * 2 ** attempt);
    else log.error({ err, tables: all }, 'Cache version bump failed; affected entries expire via TTL');
  }
}

/* ------------------------------------------------------------------ Reads */
export async function runRead(q: WireQuery): Promise<WireResult> {
  await readGate.acquire();
  try {
    stats.reads++;
    return encodeResult(await build(pool, q));
  } finally {
    readGate.release();
  }
}

/* ------------------------------------------------------------------ Writes: queued and group-committed */
interface WriteJob {
  q: WireQuery;
  tables: string[];
  enqueuedAt: number;
  resolve: (r: WireResult) => void;
  reject: (e: unknown) => void;
}
const writeQueue: WriteJob[] = [];
let flushing = false;
let flushDone: Promise<void> = Promise.resolve();

export function runWrite(q: WireQuery, tables: string[], log: FastifyBaseLogger): Promise<WireResult> {
  assertCapacity();
  stats.writes++;
  return new Promise((resolve, reject) => {
    writeQueue.push({ q, tables, enqueuedAt: Date.now(), resolve, reject });
    scheduleFlush(log);
  });
}

function scheduleFlush(log: FastifyBaseLogger) {
  if (flushing) return;
  flushing = true;
  flushDone = new Promise((done) => {
    const go = () => void flushLoop(log).finally(done);
    if (cfg.batchWindowMs > 0) setTimeout(go, cfg.batchWindowMs);
    else setImmediate(go); // collect writes that arrived in the same tick
  });
}

async function flushLoop(log: FastifyBaseLogger) {
  try {
    while (writeQueue.length) {
      const now = Date.now();
      const batch: WriteJob[] = [];
      while (writeQueue.length && batch.length < cfg.batchMax) {
        const job = writeQueue.shift()!;
        if (now - job.enqueuedAt > cfg.queueTimeoutMs) {
          stats.rejectedTimeout++;
          job.reject(new AppError(503, 'Timed out waiting for the database', 'DB_QUEUE_TIMEOUT'));
        } else batch.push(job);
      }
      if (batch.length) await runBatch(batch, log);
    }
  } finally {
    flushing = false;
    if (writeQueue.length) scheduleFlush(log);
  }
}

async function runBatch(batch: WriteJob[], log: FastifyBaseLogger) {
  if (batch.length === 1) return runSingle(batch[0]!, log);

  let results: unknown[];
  try {
    // One transaction, statements pipelined: one round trip and one commit instead of N.
    results = (await pool.begin((tx: AnySql) => Promise.all(batch.map((j) => build(tx, j.q))))) as unknown[];
  } catch {
    // Something in the batch failed, so the whole transaction rolled back and nothing was applied.
    // Re-run each statement on its own so only the failing one reports an error.
    stats.batchFallbacks++;
    for (const job of batch) await runSingle(job, log);
    return;
  }
  stats.batches++;
  stats.batchedWrites += batch.length;
  await bump(
    batch.flatMap((j) => j.tables),
    log,
  );
  batch.forEach((j, i) => j.resolve(encodeResult(results[i])));
}

async function runSingle(job: WriteJob, log: FastifyBaseLogger) {
  try {
    const r = await build(pool, job.q);
    await bump(job.tables, log);
    job.resolve(encodeResult(r));
  } catch (err) {
    job.reject(err);
  }
}

/* ------------------------------------------------------------------ Remote transactions */
class RollbackSignal extends Error {}

interface Session {
  id: string;
  schema: string;
  tx: AnySql;
  tables: Set<string>;
  finish: { resolve: () => void; reject: (e: Error) => void };
  done: Promise<void>;
  idle?: NodeJS.Timeout;
  deadline?: NodeJS.Timeout;
  running: number;
  closed: boolean;
}
const sessions = new Map<string, Session>();

export function openTransactions() {
  return sessions.size;
}

export async function openSession(schema: string, log: FastifyBaseLogger): Promise<Session> {
  await txGate.acquire();
  const s = { id: randomUUID(), schema, tables: new Set<string>(), running: 0, closed: false } as Session;
  return new Promise<Session>((resolveOpen, rejectOpen) => {
    let opened = false;
    s.done = pool.begin(async (tx: AnySql) => {
      s.tx = tx;
      opened = true;
      await new Promise<void>((resolve, reject) => {
        s.finish = { resolve, reject };
        sessions.set(s.id, s);
        resolveOpen(s);
      });
    }) as unknown as Promise<void>;
    s.done
      .catch((err) => {
        if (!opened) rejectOpen(err);
      })
      .finally(() => {
        s.closed = true;
        clearTimeout(s.idle);
        clearTimeout(s.deadline);
        sessions.delete(s.id);
        txGate.release();
      });
  }).then((sess) => {
    stats.txOpened++;
    sess.deadline = setTimeout(() => void expire(sess, 'max lifetime', log), cfg.txMaxMs);
    touch(sess, log);
    return sess;
  });
}

function touch(s: Session, log: FastifyBaseLogger) {
  clearTimeout(s.idle);
  if (s.running === 0) s.idle = setTimeout(() => void expire(s, 'idle timeout', log), cfg.txIdleMs);
}

async function expire(s: Session, reason: string, log: FastifyBaseLogger) {
  if (s.closed) return;
  stats.txExpired++;
  log.warn({ tx: s.id, schema: s.schema, reason }, 'Rolling back abandoned transaction');
  await rollbackSession(s);
}

export function getSession(id: string, schema: string): Session {
  const s = sessions.get(id);
  if (!s || s.closed) throw new AppError(409, 'The transaction has expired or was already closed', 'TX_NOT_FOUND');
  if (s.schema !== schema) throw new AppError(403, 'Transaction belongs to another service', 'TX_FORBIDDEN');
  return s;
}

export async function runInSession(s: Session, q: WireQuery, text: string, log: FastifyBaseLogger): Promise<WireResult> {
  s.running++;
  clearTimeout(s.idle);
  try {
    const r = await build(s.tx, q);
    if (isWriteSql(text)) for (const t of tablesIn(text)) s.tables.add(t);
    return encodeResult(r);
  } catch (err) {
    // A failed statement aborts the Postgres transaction; free the connection right away.
    await rollbackSession(s);
    throw Object.assign(err as object, { txClosed: true });
  } finally {
    s.running--;
    if (!s.closed) touch(s, log);
  }
}

export async function commitSession(s: Session, log: FastifyBaseLogger): Promise<void> {
  s.finish.resolve();
  await s.done; // throws if COMMIT failed
  stats.txCommitted++;
  await bump(s.tables, log);
}

export async function rollbackSession(s: Session): Promise<void> {
  if (s.closed) return;
  s.closed = true;
  s.finish.reject(new RollbackSignal('rollback'));
  await s.done.catch(() => {});
  stats.txRolledBack++;
}

/* ------------------------------------------------------------------ Lifecycle */
export function classify(q: WireQuery) {
  validateWire(q);
  const text = shapeText(q);
  return { text, write: isWriteSql(text), tables: tablesIn(text) };
}

export async function shutdown(): Promise<void> {
  await flushDone.catch(() => {});
  await Promise.all([...sessions.values()].map((s) => rollbackSession(s)));
  versions?.disconnect();
  await pool.end({ timeout: 5 });
}
