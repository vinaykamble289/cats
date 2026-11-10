import type { FastifyInstance, FastifyBaseLogger } from 'fastify';
import {
  APPLICATION_STAGES,
  APPLICATION_STATUSES,
  badRequest,
  csvList,
  getUser,
  idParams,
  optionalText,
  orNotFound,
  paginationQuery,
  parse,
  queueEmailSafe,
  requireRole,
  toLimitOffset,
  z,
} from '@hireflow/shared';
import { sql } from '../db.js';
import { createApplication, queryApplications, runAiMatch, scheduleAiMatch, transitionApplication, type TransitionResult } from '../lib/applications.js';
import { getJob, jobTitles } from '../lib/jobs.js';

const stageEnum = z.enum(APPLICATION_STAGES);
const statusEnum = z.enum(APPLICATION_STATUSES);

const stageBody = z
  .object({
    stage: stageEnum.optional(),
    status: statusEnum.optional(),
    note: optionalText(2000),
    rejectionReason: optionalText(2000),
    notifyCandidate: z.boolean().optional().default(false),
  })
  .refine((b) => b.stage || b.status, { message: 'Provide a stage or a status' });

async function sendRejections(results: TransitionResult[], titles: Map<string, string>, log: FastifyBaseLogger, actorId: string) {
  for (const r of results) {
    if (!r.changed || r.toStatus !== 'rejected') continue;
    await queueEmailSafe(
      {
        templateKey: 'rejection',
        to: r.candidateEmail,
        data: { candidateName: r.candidateName, jobTitle: titles.get(r.jobId) ?? 'the role' },
        relatedType: 'application',
        relatedId: r.applicationId,
        candidateId: r.candidateId,
        createdBy: actorId,
      },
      log,
    );
  }
}

export async function applicationRoutes(app: FastifyInstance) {
  app.get('/applications', async (req) => {
    getUser(req);
    const q = parse(
      paginationQuery.extend({
        pageSize: z.coerce.number().int().min(1).max(500).default(25),
        jobId: z.string().uuid().optional(),
        candidateId: z.string().uuid().optional(),
        stage: csvList,
        status: csvList,
        q: z.string().trim().max(200).optional(),
        sort: z.enum(['recent', 'score', 'applied']).optional(),
      }),
      req.query,
    );
    const stages = q.stage?.map((s) => parse(stageEnum, s));
    const statuses = q.status?.map((s) => parse(statusEnum, s));
    const like = q.q ? `%${q.q.replace(/[%_]/g, '\\$&')}%` : null;
    const where = sql`
      ${q.jobId ? sql`and a.job_id = ${q.jobId}` : sql``}
      ${q.candidateId ? sql`and a.candidate_id = ${q.candidateId}` : sql``}
      ${stages?.length ? sql`and a.stage = any(${stages}::talent.application_stage[])` : sql``}
      ${statuses?.length ? sql`and a.status = any(${statuses}::talent.application_status[])` : sql``}
      ${q.q ? sql`and (c.search @@ plainto_tsquery('simple', ${q.q}) or c.full_name ilike ${like} or c.email ilike ${like})` : sql``}
    `;
    const order =
      q.sort === 'score'
        ? sql`order by a.ai_match_score desc nulls last, a.applied_at desc`
        : q.sort === 'applied'
          ? sql`order by a.applied_at desc`
          : sql`order by a.stage_changed_at desc`;
    const { limit, offset } = toLimitOffset(q);
    const [data, [count]] = await Promise.all([
      queryApplications(where, { limit, offset, order }),
      sql<{ total: number }[]>`
        select count(*)::int as total from talent.applications a join talent.candidates c on c.id = a.candidate_id where true ${where}
      `,
    ]);
    return { data, total: count!.total };
  });

  app.get('/applications/stats', async (req) => {
    getUser(req);
    const { jobId } = parse(z.object({ jobId: z.string().uuid().optional() }), req.query);
    const [rows, [hired]] = await Promise.all([
      sql<{ jobId: string; stage: string; status: string; n: number }[]>`
        select job_id, stage, status, count(*)::int as n
        from talent.applications
        where true ${jobId ? sql`and job_id = ${jobId}` : sql``}
        group by job_id, stage, status
      `,
      sql<{ n: number }[]>`
        select count(distinct h.application_id)::int as n
        from talent.stage_history h join talent.applications a on a.id = h.application_id
        where h.to_status = 'hired' and h.changed_at >= date_trunc('month', now())
        ${jobId ? sql`and a.job_id = ${jobId}` : sql``}
      `,
    ]);
    const byStage: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byJob = new Map<string, { jobId: string; total: number; active: number; byStage: Record<string, number> }>();
    let total = 0;
    let active = 0;
    for (const r of rows) {
      total += r.n;
      byStatus[r.status] = (byStatus[r.status] ?? 0) + r.n;
      const j = byJob.get(r.jobId) ?? { jobId: r.jobId, total: 0, active: 0, byStage: {} };
      j.total += r.n;
      if (r.status === 'active') {
        active += r.n;
        j.active += r.n;
        byStage[r.stage] = (byStage[r.stage] ?? 0) + r.n;
        j.byStage[r.stage] = (j.byStage[r.stage] ?? 0) + r.n;
      }
      byJob.set(r.jobId, j);
    }
    return { total, active, byStage, byStatus, byJob: [...byJob.values()], hiredThisMonth: hired!.n };
  });

  app.get('/applications/:id', async (req) => {
    getUser(req);
    const { id } = parse(idParams, req.params);
    const [application] = await queryApplications(sql`and a.id = ${id}`);
    orNotFound(application, 'Application');
    const [stageHistory, reviews] = await Promise.all([
      sql`
        select id, from_stage, to_stage, from_status, to_status, note, changed_by, changed_at
        from talent.stage_history where application_id = ${id} order by changed_at desc
      `,
      sql`
        select id, application_id, reviewer_id, requested_by, status, decision, rating, comments, due_at, requested_at, submitted_at
        from talent.reviews where application_id = ${id} order by requested_at desc
      `,
    ]);
    return { ...application, stageHistory, reviews };
  });

  app.post('/applications', async (req, reply) => {
    const user = requireRole(req, 'recruiter');
    const body = parse(z.object({ candidateId: z.string().uuid(), jobId: z.string().uuid() }), req.body);
    const job = await getJob(body.jobId);
    const [c] = await sql<{ fullName: string }[]>`select full_name from talent.candidates where id = ${body.candidateId}`;
    orNotFound(c, 'Candidate');
    const result = await sql.begin((tx) =>
      createApplication(tx, { candidateId: body.candidateId, candidateName: c!.fullName, jobId: job.id, jobTitle: job.title, actorId: user.id }),
    );
    if (!result.created) throw badRequest('This candidate has already applied to this job');
    scheduleAiMatch([result.id], req.log);
    reply.status(201);
    const [application] = await queryApplications(sql`and a.id = ${result.id}`);
    return application;
  });

  app.post('/applications/:id/stage', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const body = parse(stageBody, req.body);
    const [current] = await sql<{ jobId: string }[]>`select job_id from talent.applications where id = ${id}`;
    orNotFound(current, 'Application');
    const titles = await jobTitles([current!.jobId]);
    const result = await sql.begin((tx) =>
      transitionApplication(tx, id, { ...body, actorId: user.id, jobTitle: titles.get(current!.jobId) ?? null }),
    );
    if (result && body.notifyCandidate) await sendRejections([result], titles, req.log, user.id);
    const [application] = await queryApplications(sql`and a.id = ${id}`);
    return application;
  });

  app.post('/applications/bulk/stage', async (req) => {
    const user = requireRole(req, 'recruiter');
    const body = parse(
      z
        .object({
          applicationIds: z.array(z.string().uuid()).min(1).max(500),
          stage: stageEnum.optional(),
          status: statusEnum.optional(),
          note: optionalText(2000),
          rejectionReason: optionalText(2000),
          notifyCandidate: z.boolean().optional().default(false),
        })
        .refine((b) => b.stage || b.status, { message: 'Provide a stage or a status' }),
      req.body,
    );
    const ids = [...new Set(body.applicationIds)];
    const apps = await sql<{ id: string; jobId: string }[]>`select id, job_id from talent.applications where id = any(${ids}::uuid[])`;
    const jobOf = new Map(apps.map((a) => [a.id, a.jobId]));
    const titles = await jobTitles(apps.map((a) => a.jobId));
    const results = await sql.begin(async (tx) => {
      const out: TransitionResult[] = [];
      for (const id of ids) {
        const r = await transitionApplication(tx, id, {
          stage: body.stage,
          status: body.status,
          note: body.note,
          rejectionReason: body.rejectionReason,
          actorId: user.id,
          jobTitle: titles.get(jobOf.get(id) ?? '') ?? null,
        });
        if (r) out.push(r);
      }
      return out;
    });
    if (body.notifyCandidate) await sendRejections(results, titles, req.log, user.id);
    return { updated: results.filter((r) => r.changed).length };
  });

  app.post('/applications/:id/rematch', async (req) => {
    requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const [exists] = await sql`select 1 from talent.applications where id = ${id}`;
    orNotFound(exists, 'Application');
    await runAiMatch(id);
    const [application] = await queryApplications(sql`and a.id = ${id}`);
    return application;
  });
}
