import type { FastifyInstance } from 'fastify';
import { csvList, idParams, notFound, orNotFound, parse, publishEvent, z } from '@hireflow/shared';
import { sql } from '../db.js';
import { getJob, toJobContext } from '../repo.js';

export async function internalRoutes(app: FastifyInstance) {
  app.get('/internal/jobs', async (req) => {
    const q = parse(z.object({ ids: csvList }), req.query);
    const ids = (q.ids ?? []).filter((id) => z.string().uuid().safeParse(id).success);
    if (!ids.length) return [];
    return sql`select id, code, title, status from jobs.jobs where id = any(${sql.array(ids)}::uuid[])`;
  });

  app.get('/internal/jobs/by-slug/:slug', async (req) => {
    const { slug } = parse(z.object({ slug: z.string().min(1).max(200) }), req.params);
    return toJobContext(orNotFound(await getJob(sql, { slug }), 'Job'));
  });

  app.get('/internal/jobs/by-code/:code', async (req) => {
    const { code } = parse(z.object({ code: z.string().min(1).max(40) }), req.params);
    return toJobContext(orNotFound(await getJob(sql, { code }), 'Job'));
  });

  app.get('/internal/jobs/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    return toJobContext(orNotFound(await getJob(sql, { id }), 'Job'));
  });

  /** A hire joined: filled += 1; position closes automatically when every opening is filled. */
  app.post('/internal/jobs/:id/fill', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ actorId: z.string().uuid().optional(), candidateName: z.string().optional() }).passthrough(), req.body);
    return sql.begin(async (tx) => {
      const [job] = await tx<{ id: string; title: string; filled: number; openings: number; status: string }[]>`
        update jobs.jobs set
          filled = filled + 1,
          status = case when filled + 1 >= openings then 'filled'::jobs.job_status else status end,
          closed_at = case when filled + 1 >= openings then now() else closed_at end
        where id = ${id}
        returning id, title, filled, openings, status`;
      if (!job) throw notFound('Job');
      const fullyFilled = job.status === 'filled';
      await publishEvent(tx, {
        type: fullyFilled ? 'job.filled' : 'job.updated',
        aggregateType: 'job',
        aggregateId: id,
        jobId: id,
        actorId: body.actorId ?? null,
        payload: { title: job.title, filled: job.filled, openings: job.openings, candidateName: body.candidateName ?? null },
      });
      return { ok: true, filled: job.filled, openings: job.openings, status: job.status };
    });
  });
}
