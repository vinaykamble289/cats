import type { FastifyReply } from 'fastify';
import { AppError, DB_SCHEMAS, startService } from '@hireflow/shared';
import {
  cfg,
  classify,
  commitSession,
  getSession,
  guard,
  loadCascades,
  openSession,
  openTransactions,
  pool,
  queueDepth,
  rollbackSession,
  runInSession,
  runRead,
  runWrite,
  shutdown,
  stats,
} from './engine.js';

/**
 * Central DB service: the only process that connects to Supabase Postgres.
 * Every other service sends its statements here (see @hireflow/shared createDb).
 *
 *   reads          -> pipelined over the connection, bounded concurrency
 *   writes         -> queued and group-committed in batches
 *   transactions   -> remote sessions holding a connection until commit/rollback
 *   after commits  -> table versions bumped in Redis (cache invalidation)
 */

const SERVICE_SCHEMAS = new Set<string>(DB_SCHEMAS.filter((s) => s !== 'platform'));

function callerSchema(header: unknown): string {
  if (typeof header !== 'string' || !SERVICE_SCHEMAS.has(header)) throw new AppError(400, 'Missing or unknown x-db-schema header', 'BAD_SCHEMA');
  return header;
}

/** Postgres errors are forwarded field-for-field so callers can keep checking `err.code === '23505'`. */
function sendError(reply: FastifyReply, err: unknown) {
  const e = err as Record<string, unknown> & { txClosed?: boolean };
  if (typeof e?.code === 'string' && typeof e?.severity === 'string') {
    const pg: Record<string, unknown> = {};
    for (const k of ['message', 'code', 'severity', 'detail', 'hint', 'position', 'schema_name', 'table_name', 'column_name', 'constraint_name', 'routine']) if (e[k] !== undefined) pg[k] = e[k];
    return reply.status(422).send({ error: { code: 'PG_ERROR', message: String(e.message), pg, txClosed: e.txClosed } });
  }
  if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, txClosed: e.txClosed } });
  reply.log.error({ err }, 'DB service error');
  return reply.status(500).send({ error: { code: 'DB_ERROR', message: 'Database operation failed', txClosed: e?.txClosed } });
}

const app = await startService({
  name: 'db',
  bodyLimitMb: Number(process.env.DB_BODY_LIMIT_MB || 16),
  healthCheck: () => pool`select 1`,
  routes: async (app) => {
    await loadCascades(app.log);

    app.post('/internal/db/query', async (req, reply) => {
      try {
        const schema = callerSchema(req.headers['x-db-schema']);
        const body = req.body as { q: unknown; tx?: string; begin?: boolean };
        const { text, write, tables } = classify(body?.q as never);
        const q = body.q as never;
        guard(schema, text, write, req.log);

        if (body.tx) return { result: await runInSession(getSession(body.tx, schema), q, text, req.log) };
        if (body.begin) {
          const s = await openSession(schema, req.log);
          return { tx: s.id, result: await runInSession(s, q, text, req.log) };
        }
        return { result: write ? await runWrite(q, tables, req.log) : await runRead(q) };
      } catch (err) {
        return sendError(reply, err);
      }
    });

    app.post('/internal/db/tx/:id/commit', async (req, reply) => {
      try {
        const s = getSession((req.params as { id: string }).id, callerSchema(req.headers['x-db-schema']));
        await commitSession(s, req.log);
        return { ok: true };
      } catch (err) {
        return sendError(reply, err);
      }
    });

    app.post('/internal/db/tx/:id/rollback', async (req) => {
      try {
        await rollbackSession(getSession((req.params as { id: string }).id, callerSchema(req.headers['x-db-schema'])));
      } catch {
        /* already gone: rollback is idempotent */
      }
      return { ok: true };
    });

    app.get('/internal/db/stats', async () => ({
      config: cfg,
      queue: queueDepth(),
      openTransactions: openTransactions(),
      ...stats,
    }));
  },
  onClose: shutdown,
});

app.log.info({ poolMax: cfg.poolMax, batchMax: cfg.batchMax, guard: cfg.guard }, 'DB service ready');
