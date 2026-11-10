import type { FastifyInstance } from 'fastify';
import { notFound, parse, z } from '@hireflow/shared';
import { sql } from '../db.js';

const publicColumns = sql`
  j.id, j.title, j.slug, j.code, j.location, j.employment_type, j.work_mode,
  j.experience_min, j.experience_max, j.published_at,
  coalesce((select json_agg(s.name order by s.is_required desc, lower(s.name)) from jobs.job_skills s where s.job_id = j.id), '[]'::json) as skills
`;

export async function publicRoutes(app: FastifyInstance) {
  app.get('/public/careers', async (_req, reply) => {
    const data = await sql`
      select ${publicColumns} from jobs.jobs j
      where j.status = 'open'
      order by j.published_at desc nulls last, j.created_at desc`;
    reply.header('cache-control', 'public, max-age=60');
    return { data, total: data.length };
  });

  app.get('/public/careers/:slug', async (req) => {
    const { slug } = parse(z.object({ slug: z.string().min(1).max(200) }), req.params);
    const [job] = await sql`
      select ${publicColumns}, j.description, j.salary_min, j.salary_max, j.currency
      from jobs.jobs j where j.slug = ${slug} and j.status = 'open'`;
    if (!job) throw notFound('Job opening');
    return job;
  });
}
