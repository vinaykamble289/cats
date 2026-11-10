/**
 * Wire format between services and the central DB service.
 *
 * A query is shipped *structurally* — the template strings plus tagged values —
 * and the DB service rebuilds the identical postgres.js tagged-template call.
 * That keeps postgres.js semantics exactly (helpers like `sql(obj)`, nested
 * fragments, `sql.json`, `sql.array`, camelCase transforms) without
 * re-implementing its query builder.
 */

export interface WireQuery {
  /** Template strings */
  s: string[];
  /** Tagged values, one per gap between strings */
  v: WireValue[];
}

export type WireValue =
  | null
  | string
  | number
  | boolean
  | { $: 'd'; v: string } // Date
  | { $: 'n'; v: string } // bigint
  | { $: 'b'; v: string } // bytes (base64)
  | { $: 'j'; v: unknown } // sql.json(value)
  | { $: 'a'; v: WireValue[]; t?: number } // sql.array(values, type)
  | { $: 'l'; v: WireValue[] } // plain JS array
  | { $: 'o'; v: Record<string, WireValue> } // plain object (helper payloads)
  | { $: 'q'; q: WireQuery } // nested fragment
  | { $: 'h'; f: WireValue; c: string[] }; // helper: sql(first, ...columns)

export interface WireResult {
  rows: Record<string, unknown>[];
  /** [column name (already camelCased), postgres type oid] */
  cols: [string, number][];
  count: number | null;
  command: string | null;
}

/** Schemas owned by services (+ the shared event log). Used for table extraction and the schema guard. */
export const DB_SCHEMAS = ['platform', 'identity', 'jobs', 'talent', 'assessment', 'interview', 'offer', 'onboarding', 'notify'] as const;

const TABLE_RE = new RegExp(`\\b(${DB_SCHEMAS.join('|')})\\.([a-z_][a-z0-9_]*)\\b`, 'gi');
const WRITE_RE = /\b(insert\s+into|delete\s+from|merge\s+into|truncate)\b|\bupdate\s+(only\s+)?[a-z_]+\.[a-z_]+/i;
/** Results depend on the clock / randomness / sequences, or take locks: never cache. */
const VOLATILE_RE = /\b(now|current_timestamp|current_date|current_time|localtimestamp|localtime|clock_timestamp|statement_timestamp|transaction_timestamp|random|gen_random_uuid|uuid_generate_v4|nextval|setval|txid_current|pg_advisory\w*|pg_try_advisory\w*)\b|\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i;

/** All SQL text of a query including nested fragments (values replaced by placeholders). */
export function shapeText(q: WireQuery): string {
  let out = '';
  q.s.forEach((str, i) => {
    out += str;
    if (i < q.v.length) out += valueShape(q.v[i]);
  });
  return out;
}

function valueShape(v: WireValue): string {
  if (v && typeof v === 'object' && '$' in v) {
    if (v.$ === 'q') return ` ${shapeText(v.q)} `;
    if (v.$ === 'h') return ' $h ';
  }
  return ' $v ';
}

/** Schema-qualified tables mentioned in the SQL (over-inclusive by design: aliases or casts may add harmless extras). */
export function tablesIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(TABLE_RE)) out.add(`${m[1]!.toLowerCase()}.${m[2]!.toLowerCase()}`);
  return [...out];
}

export function isWriteSql(text: string): boolean {
  return WRITE_RE.test(text);
}

export function isVolatileSql(text: string): boolean {
  return VOLATILE_RE.test(text);
}

/** Postgres type oids that need reviving after JSON transport. */
export const TS_OIDS = new Set([1114, 1184]); // timestamp, timestamptz
export const TS_ARRAY_OIDS = new Set([1115, 1185]);
export const BYTEA_OID = 17;
