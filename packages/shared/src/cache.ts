import { createHash, randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { optional } from './env.js';
import type { WireQuery, WireResult } from './db-wire.js';
import { CACHE_DB_INDEX, createRedis, EPOCH_FIELD, VERSION_DB, VERSION_KEY } from './redis.js';

/**
 * Read-through query cache for one service.
 *
 * Invalidation is version based: the DB service bumps a per-table counter in the
 * shared version hash after every committed write. A cache key embeds the current
 * versions of every table the query reads, so any write to any of those tables
 * (from any service) makes old entries unreachable immediately. TTL only bounds
 * memory and protects against writes made outside the platform (SQL editor, scripts).
 *
 * Fail-open: any Redis error means "cache miss", never a failed request.
 */
export class QueryCache {
  private readonly versions: Redis;
  private readonly store: Redis;
  private readonly ttl: number;
  private readonly maxBytes: number;
  private readonly inflight = new Map<string, Promise<WireResult>>();
  readonly stats = { hits: 0, misses: 0, bypass: 0, errors: 0, stored: 0, tooLarge: 0 };

  constructor(private readonly schema: string) {
    const shared = optional('REDIS_URL');
    const own = optional(`${schema.toUpperCase()}_REDIS_URL`);
    this.versions = createRedis(shared, { db: VERSION_DB, name: `${schema}-versions` });
    // A dedicated per-service Redis uses its own URL as-is; on a shared server each service gets its own logical db.
    this.store = own ? createRedis(own, { name: `${schema}-cache` }) : createRedis(shared, { db: CACHE_DB_INDEX[schema] ?? 15, name: `${schema}-cache` });
    this.ttl = Number(optional('CACHE_TTL_SECONDS', '60'));
    this.maxBytes = Number(optional('CACHE_MAX_ENTRY_KB', '512')) * 1024;
  }

  static fromEnv(schema: string): QueryCache | null {
    if (!optional('REDIS_URL') || optional('CACHE_ENABLED', 'true') === 'false') return null;
    return new QueryCache(schema);
  }

  async read(q: WireQuery, tables: string[], load: () => Promise<WireResult>): Promise<WireResult> {
    let key: string;
    try {
      key = await this.key(q, tables);
    } catch {
      this.stats.errors++;
      this.stats.bypass++;
      return load();
    }

    try {
      const hit = await this.store.get(key);
      if (hit) {
        this.stats.hits++;
        return JSON.parse(hit) as WireResult;
      }
    } catch {
      this.stats.errors++;
    }

    // Single-flight: identical concurrent misses share one DB round trip.
    const pending = this.inflight.get(key);
    if (pending) {
      this.stats.hits++;
      return pending;
    }
    this.stats.misses++;
    const p = load().then((res) => {
      this.save(key, res);
      return res;
    });
    this.inflight.set(key, p);
    try {
      return await p;
    } finally {
      this.inflight.delete(key);
    }
  }

  private save(key: string, res: WireResult) {
    const body = JSON.stringify(res);
    if (body.length > this.maxBytes) {
      this.stats.tooLarge++;
      return;
    }
    this.store.set(key, body, 'EX', this.ttl).then(
      () => this.stats.stored++,
      () => this.stats.errors++,
    );
  }

  private async key(q: WireQuery, tables: string[]): Promise<string> {
    const fields = [EPOCH_FIELD, ...tables];
    let vals = await this.versions.hmget(VERSION_KEY, ...fields);
    if (!vals[0]) {
      // First use (or version store was wiped): establish a fresh epoch so stale keys can't match.
      await this.versions.hsetnx(VERSION_KEY, EPOCH_FIELD, randomUUID());
      vals = await this.versions.hmget(VERSION_KEY, ...fields);
    }
    const h = createHash('sha1').update(JSON.stringify(q)).update('|').update(vals.map((v) => v ?? '0').join(',')).digest('base64url');
    return `hf:c:${this.schema}:${h}`;
  }

  async close(): Promise<void> {
    this.versions.disconnect();
    this.store.disconnect();
  }
}
