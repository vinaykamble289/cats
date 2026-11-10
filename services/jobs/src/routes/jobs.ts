import type { FastifyInstance } from 'fastify';
import {
  badRequest,
  csvList,
  defined,
  env,
  getUser,
  idParams,
  notFound,
  optionalText,
  orNotFound,
  paginationQuery,
  parse,
  publishEvent,
  requireRole,
  toLimitOffset,
  z,
} from '@hireflow/shared';
import { sql } from '../db.js';
import { DEFAULT_PLAN, getJob, listJobs, replacePlan, replaceReviewers, replaceSkills, slugify, type JobStatus } from '../repo.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const num = (max: number) => z.coerce.number().min(0).max(max);

const skillSchema = z.object({ name: z.string().trim().min(1).max(80), isRequired: z.boolean().default(true) });
const planRoundSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['ai_screening', 'ai_proctored', 'human']),
  durationMin: z.coerce.number().int().min(5).max(240).default(30),
  questionCount: z.coerce.number().int().min(1).max(30).default(6),
  passScore: z.coerce.number().int().min(0).max(100).default(60),
  focusAreas: optionalText(2000),
});

/** Fields shared by create & update - no defaults so partial updates stay partial. */
const jobFields = z.object({
  title: z.string().trim().min(1).max(200),
  departmentId: z.string().uuid().nullish(),
  location: optionalText(200),
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'internship']),
  workMode: z.enum(['onsite', 'remote', 'hybrid']),
  experienceMin: num(60).nullish(),
  experienceMax: num(60).nullish(),
  salaryMin: num(1e12).nullish(),
  salaryMax: num(1e12).nullish(),
  currency: z.string().trim().length(3).transform((s) => s.toUpperCase()),
  openings: z.coerce.number().int().min(1).max(10000),
  description: z.string().max(50000),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  hiringManagerId: z.string().uuid().nullish(),
  recruiterId: z.string().uuid().nullish(),
  targetDate: dateStr.nullish(),
  skills: z.array(skillSchema).max(60),
  reviewerIds: z.array(z.string().uuid()).max(50),
  interviewPlan: z.array(planRoundSchema).max(10),
});

const createSchema = jobFields.partial().extend({
  title: jobFields.shape.title,
  status: z.enum(['draft', 'open']).default('draft'),
});
const updateSchema = jobFields.partial();

const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  draft: ['open', 'closed'],
  open: ['on_hold', 'closed', 'draft'],
  on_hold: ['open', 'closed'],
  closed: ['open', 'draft'],
  filled: ['open', 'closed'],
};

function checkRanges(b: { experienceMin?: number | null; experienceMax?: number | null; salaryMin?: number | null; salaryMax?: number | null }) {
  if (b.experienceMin != null && b.experienceMax != null && b.experienceMax < b.experienceMin) throw badRequest('Maximum experience must be ≥ minimum experience');
  if (b.salaryMin != null && b.salaryMax != null && b.salaryMax < b.salaryMin) throw badRequest('Maximum salary must be ≥ minimum salary');
}

export async function jobRoutes(app: FastifyInstance) {
  app.get('/jobs', async (req) => {
    getUser(req);
    const q = parse(
      paginationQuery.extend({ status: csvList, q: z.string().trim().max(100).optional(), departmentId: z.string().uuid().optional() }),
      req.query,
    );
    const { limit, offset } = toLimitOffset(q);
    return listJobs(sql, { status: q.status, q: q.q, departmentId: q.departmentId, limit, offset });
  });

  app.get('/jobs/stats', async (req) => {
    getUser(req);
    const rows = await sql<{ status: JobStatus; count: number; openPositions: number }[]>`
      select status, count(*)::int as count,
             coalesce(sum(greatest(openings - filled, 0)) filter (where status = 'open'), 0)::int as open_positions
      from jobs.jobs group by status`;
    const byStatus: Record<JobStatus, number> = { draft: 0, open: 0, on_hold: 0, closed: 0, filled: 0 };
    let total = 0;
    let openPositions = 0;
    for (const r of rows) {
      byStatus[r.status] = r.count;
      total += r.count;
      openPositions += r.openPositions;
    }
    return { total, byStatus, openPositions };
  });

  app.get('/jobs/:id', async (req) => {
    getUser(req);
    const { id } = parse(idParams, req.params);
    return orNotFound(await getJob(sql, { id }), 'Job');
  });

  app.post('/jobs', async (req, reply) => {
    const user = requireRole(req, 'recruiter');
    const b = parse(createSchema, req.body);
    checkRanges(b);
    const job = await sql.begin(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into jobs.jobs ${tx({
          title: b.title,
          slug: slugify(b.title),
          departmentId: b.departmentId ?? null,
          location: b.location ?? null,
          employmentType: b.employmentType ?? 'full_time',
          workMode: b.workMode ?? 'onsite',
          experienceMin: b.experienceMin ?? null,
          experienceMax: b.experienceMax ?? null,
          salaryMin: b.salaryMin ?? null,
          salaryMax: b.salaryMax ?? null,
          currency: b.currency ?? env.defaultCurrency,
          openings: b.openings ?? 1,
          description: b.description ?? '',
          status: b.status,
          priority: b.priority ?? 'medium',
          hiringManagerId: b.hiringManagerId ?? null,
          recruiterId: b.recruiterId ?? user.id,
          targetDate: b.targetDate ?? null,
          publishedAt: b.status === 'open' ? new Date() : null,
          createdBy: user.id,
        })}
        returning id`;
      await replaceSkills(tx, row.id, b.skills ?? []);
      await replaceReviewers(tx, row.id, b.reviewerIds ?? []);
      await replacePlan(tx, row.id, b.interviewPlan?.length ? b.interviewPlan.map((r) => ({ ...r, focusAreas: r.focusAreas ?? null })) : DEFAULT_PLAN);
      const job = (await getJob(tx, { id: row.id }))!;
      await publishEvent(tx, {
        type: 'job.created',
        aggregateType: 'job',
        aggregateId: job.id,
        jobId: job.id,
        actorId: user.id,
        payload: { title: job.title, code: job.code, status: job.status },
      });
      return job;
    });
    return reply.status(201).send(job);
  });

  app.patch('/jobs/:id', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const b = parse(updateSchema, req.body);
    return sql.begin(async (tx) => {
      const existing = orNotFound(await getJob(tx, { id }), 'Job');
      checkRanges({
        experienceMin: b.experienceMin !== undefined ? b.experienceMin : existing.experienceMin,
        experienceMax: b.experienceMax !== undefined ? b.experienceMax : existing.experienceMax,
        salaryMin: b.salaryMin !== undefined ? b.salaryMin : existing.salaryMin,
        salaryMax: b.salaryMax !== undefined ? b.salaryMax : existing.salaryMax,
      });
      const { skills, reviewerIds, interviewPlan, ...fields } = b;
      const patch = defined(fields);
      if (patch.openings !== undefined && patch.openings < existing.filled) throw badRequest(`Openings cannot be less than already filled positions (${existing.filled})`);
      if (Object.keys(patch).length) await tx`update jobs.jobs set ${tx(patch)} where id = ${id}`;
      if (skills) await replaceSkills(tx, id, skills);
      if (reviewerIds) await replaceReviewers(tx, id, reviewerIds);
      if (interviewPlan) {
        if (!interviewPlan.length) throw badRequest('The interview plan needs at least one round');
        await replacePlan(tx, id, interviewPlan.map((r) => ({ ...r, focusAreas: r.focusAreas ?? null })));
      }
      const job = (await getJob(tx, { id }))!;
      await publishEvent(tx, {
        type: 'job.updated',
        aggregateType: 'job',
        aggregateId: id,
        jobId: id,
        actorId: user.id,
        payload: { title: job.title, fields: Object.keys(b) },
      });
      return job;
    });
  });

  app.post('/jobs/:id/status', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const b = parse(z.object({ status: z.enum(['open', 'on_hold', 'closed', 'draft']), reason: optionalText(1000) }), req.body);
    return sql.begin(async (tx) => {
      const [cur] = await tx<{ status: JobStatus; title: string }[]>`select status, title from jobs.jobs where id = ${id} for update`;
      if (!cur) throw notFound('Job');
      if (cur.status === b.status) return (await getJob(tx, { id }))!;
      if (!TRANSITIONS[cur.status].includes(b.status)) throw badRequest(`Cannot change a ${cur.status.replace('_', ' ')} job to ${b.status.replace('_', ' ')}`);
      await tx`
        update jobs.jobs set
          status = ${b.status},
          published_at = case when ${b.status} = 'open' then coalesce(published_at, now()) else published_at end,
          closed_at = case when ${b.status} = 'closed' then now() when ${b.status} in ('open', 'draft') then null else closed_at end,
          close_reason = case when ${b.status} = 'closed' then ${b.reason ?? null} when ${b.status} in ('open', 'draft') then null else close_reason end
        where id = ${id}`;
      await publishEvent(tx, {
        type: 'job.status_changed',
        aggregateType: 'job',
        aggregateId: id,
        jobId: id,
        actorId: user.id,
        payload: { title: cur.title, from: cur.status, to: b.status, reason: b.reason ?? null },
      });
      return (await getJob(tx, { id }))!;
    });
  });

  app.post('/jobs/:id/duplicate', async (req, reply) => {
    const user = requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const job = await sql.begin(async (tx) => {
      const src = orNotFound(await getJob(tx, { id }), 'Job');
      const title = `${src.title} (copy)`.slice(0, 200);
      const [row] = await tx<{ id: string }[]>`
        insert into jobs.jobs ${tx({
          title,
          slug: slugify(src.title),
          departmentId: src.departmentId,
          location: src.location,
          employmentType: src.employmentType,
          workMode: src.workMode,
          experienceMin: src.experienceMin,
          experienceMax: src.experienceMax,
          salaryMin: src.salaryMin,
          salaryMax: src.salaryMax,
          currency: src.currency,
          openings: src.openings,
          description: src.description ?? '',
          status: 'draft',
          priority: src.priority,
          hiringManagerId: src.hiringManagerId,
          recruiterId: src.recruiterId ?? user.id,
          targetDate: src.targetDate,
          createdBy: user.id,
        })}
        returning id`;
      await replaceSkills(tx, row.id, src.skills);
      await replaceReviewers(tx, row.id, src.reviewerIds);
      await replacePlan(tx, row.id, src.interviewPlan ?? DEFAULT_PLAN);
      const job = (await getJob(tx, { id: row.id }))!;
      await publishEvent(tx, {
        type: 'job.created',
        aggregateType: 'job',
        aggregateId: job.id,
        jobId: job.id,
        actorId: user.id,
        payload: { title: job.title, code: job.code, status: job.status, duplicatedFrom: src.code },
      });
      return job;
    });
    return reply.status(201).send(job);
  });

  app.delete('/jobs/:id', async (req, reply) => {
    requireRole(req);
    const { id } = parse(idParams, req.params);
    const [cur] = await sql<{ status: JobStatus }[]>`select status from jobs.jobs where id = ${id}`;
    if (!cur) throw notFound('Job');
    if (cur.status !== 'draft') throw badRequest('Only draft jobs can be deleted. Close the job instead.');
    await sql`delete from jobs.jobs where id = ${id}`;
    return reply.status(204).send();
  });
}
