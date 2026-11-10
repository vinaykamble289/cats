import type { FastifyInstance } from 'fastify';
import { getUser, parse, z } from '@hireflow/shared';
import { sql } from '../db.js';

export async function activityRoutes(app: FastifyInstance) {
  /** Activity feed from the shared domain event log, newest first, cursor = `before` (event id). */
  app.get('/activity', async (req) => {
    getUser(req);
    const q = parse(
      z.object({
        candidateId: z.string().uuid().optional(),
        jobId: z.string().uuid().optional(),
        applicationId: z.string().uuid().optional(),
        type: z.string().max(100).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        before: z.coerce.number().int().positive().optional(),
      }),
      req.query,
    );
    const data = await sql`
      select id, type, aggregate_type, aggregate_id, candidate_id, job_id, application_id, actor_id, payload, created_at
      from platform.events
      where true
      ${q.candidateId ? sql`and candidate_id = ${q.candidateId}` : sql``}
      ${q.jobId ? sql`and job_id = ${q.jobId}` : sql``}
      ${q.applicationId ? sql`and application_id = ${q.applicationId}` : sql``}
      ${q.type ? sql`and type like ${q.type.replace(/[%_]/g, '') + '%'}` : sql``}
      ${q.before ? sql`and id < ${q.before}` : sql``}
      order by id desc
      limit ${q.limit}`;
    return { data };
  });
}
