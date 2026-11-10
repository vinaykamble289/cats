import type { FastifyInstance } from 'fastify';
import {
  addDays,
  APPLICATION_STAGES,
  badRequest,
  callService,
  conflict,
  createToken,
  csvList,
  formatDateTime,
  getUser,
  idParams,
  orNotFound,
  paginationQuery,
  parse,
  portalUrl,
  publishEvent,
  queueEmailSafe,
  requireRole,
  toLimitOffset,
  z,
  type ApplicationContext,
} from '@hireflow/shared';
import type { FastifyBaseLogger } from 'fastify';
import { sql } from '../db.js';
import { jobLookup } from '../lib/context.js';
import { gradeInvitation } from '../lib/grading.js';
import { proctoringSummary } from '../lib/proctoring.js';

const STATUSES = ['invited', 'started', 'submitted', 'graded', 'expired', 'cancelled'] as const;

const invitationColumns = sql`
  i.id, i.test_id, t.title as test_title, i.application_id, i.candidate_id, i.job_id, i.candidate_name, i.candidate_email,
  i.status, i.expires_at, i.started_at, i.deadline_at, i.submitted_at, i.graded_at, i.score, i.max_score, i.percent,
  i.passed, i.integrity_score, i.ai_summary, i.created_at
`;

async function getInvitation(id: string) {
  const [inv] = await sql`select ${invitationColumns} from assessment.invitations i join assessment.tests t on t.id = i.test_id where i.id = ${id}`;
  return orNotFound(inv, 'Invitation');
}

const ASSESSMENT_INDEX = APPLICATION_STAGES.indexOf('assessment');

/** Moves the application to the Assessment stage unless it is already further along. */
async function advanceStage(ctx: ApplicationContext, actorId: string, testTitle: string, log: FastifyBaseLogger) {
  if (ctx.status !== 'active' || APPLICATION_STAGES.indexOf(ctx.stage) >= ASSESSMENT_INDEX) return;
  await callService('talent', `/internal/applications/${ctx.id}/stage`, {
    method: 'POST',
    body: { stage: 'assessment', note: `Invited to test: ${testTitle}`, actorId },
  }).catch((err) => log.error({ err, applicationId: ctx.id }, 'Failed to move application to assessment stage'));
}

async function sendInviteEmail(
  inv: { id: string; candidateId: string; candidateName: string; candidateEmail: string; expiresAt: Date },
  token: string,
  test: { title: string; durationMin: number },
  jobTitle: string,
  actorId: string,
  log: FastifyBaseLogger,
) {
  await queueEmailSafe(
    {
      templateKey: 'assessment_invite',
      to: inv.candidateEmail,
      data: {
        candidateName: inv.candidateName,
        jobTitle,
        testTitle: test.title,
        durationMin: test.durationMin,
        link: portalUrl('assessment', token),
        expiresAt: formatDateTime(inv.expiresAt),
      },
      relatedType: 'invitation',
      relatedId: inv.id,
      candidateId: inv.candidateId,
      createdBy: actorId,
    },
    log,
  );
}

export async function invitationRoutes(app: FastifyInstance) {
  app.get('/invitations/stats', async (req) => {
    getUser(req);
    const rows = await sql<{ status: string; passed: boolean | null; n: number }[]>`
      select status, passed, count(*)::int as n from assessment.invitations group by status, passed
    `;
    const byStatus: Record<string, number> = {};
    let passed = 0;
    let failed = 0;
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + r.n;
      if (r.status === 'graded' && r.passed === true) passed += r.n;
      if (r.status === 'graded' && r.passed === false) failed += r.n;
    }
    return { byStatus, passed, failed };
  });

  app.post('/invitations', async (req) => {
    const user = requireRole(req, 'recruiter');
    const body = parse(
      z.object({
        testId: z.string().uuid(),
        applicationIds: z.array(z.string().uuid()).min(1).max(200),
        expiresInDays: z.coerce.number().int().min(1).max(30).default(3),
      }),
      req.body,
    );
    const [test] = await sql<{ id: string; title: string; durationMin: number; status: string; questionCount: number }[]>`
      select t.id, t.title, t.duration_min, t.status,
             (select count(*)::int from assessment.questions q where q.test_id = t.id) as question_count
      from assessment.tests t where t.id = ${body.testId}
    `;
    orNotFound(test, 'Test');
    if (test!.status === 'archived') throw badRequest('This test is archived');
    if (!test!.questionCount) throw badRequest('Add questions to the test before inviting candidates');
    if (test!.status === 'draft') await sql`update assessment.tests set status = 'active' where id = ${test!.id}`;

    const jobs = jobLookup();
    let created = 0;
    let skipped = 0;
    const errors: { applicationId: string; error: string }[] = [];

    for (const applicationId of [...new Set(body.applicationIds)]) {
      try {
        const ctx = await callService<ApplicationContext>('talent', `/internal/applications/${applicationId}`);
        if (ctx.status !== 'active') {
          skipped++;
          continue;
        }
        const job = await jobs(ctx.jobId);
        const { token, hash } = createToken();
        const expiresAt = addDays(body.expiresInDays);
        const inv = await sql.begin(async (tx) => {
          const [row] = await tx<{ id: string }[]>`
            insert into assessment.invitations
              (test_id, application_id, candidate_id, job_id, candidate_name, candidate_email, token_hash, expires_at, created_by)
            values (${test!.id}, ${ctx.id}, ${ctx.candidateId}, ${ctx.jobId}, ${ctx.candidateName}, ${ctx.candidateEmail}, ${hash}, ${expiresAt}, ${user.id})
            on conflict do nothing
            returning id
          `;
          if (!row) return null;
          await publishEvent(tx, {
            type: 'assessment.invited',
            aggregateType: 'invitation',
            aggregateId: row.id,
            candidateId: ctx.candidateId,
            jobId: ctx.jobId,
            applicationId: ctx.id,
            actorId: user.id,
            payload: { candidateName: ctx.candidateName, jobTitle: job?.title ?? null, testTitle: test!.title },
          });
          return row;
        });
        if (!inv) {
          skipped++; // already has an active invitation for this test
          continue;
        }
        created++;
        await sendInviteEmail(
          { id: inv.id, candidateId: ctx.candidateId, candidateName: ctx.candidateName, candidateEmail: ctx.candidateEmail, expiresAt },
          token,
          test!,
          job?.title ?? 'the role',
          user.id,
          req.log,
        );
        await advanceStage(ctx, user.id, test!.title, req.log);
      } catch (err) {
        errors.push({ applicationId, error: (err as Error).message });
      }
    }
    return { created, skipped, errors };
  });

  app.get('/invitations', async (req) => {
    getUser(req);
    const q = parse(
      paginationQuery.extend({
        testId: z.string().uuid().optional(),
        applicationId: z.string().uuid().optional(),
        candidateId: z.string().uuid().optional(),
        status: csvList,
      }),
      req.query,
    );
    const statuses = q.status?.map((s) => parse(z.enum(STATUSES), s));
    const where = sql`
      ${q.testId ? sql`and i.test_id = ${q.testId}` : sql``}
      ${q.applicationId ? sql`and i.application_id = ${q.applicationId}` : sql``}
      ${q.candidateId ? sql`and i.candidate_id = ${q.candidateId}` : sql``}
      ${statuses?.length ? sql`and i.status = any(${statuses}::assessment.invitation_status[])` : sql``}
    `;
    const { limit, offset } = toLimitOffset(q);
    const [data, [count]] = await Promise.all([
      sql`
        select ${invitationColumns} from assessment.invitations i join assessment.tests t on t.id = i.test_id
        where true ${where} order by i.created_at desc limit ${limit} offset ${offset}
      `,
      sql<{ total: number }[]>`select count(*)::int as total from assessment.invitations i where true ${where}`,
    ]);
    return { data, total: count!.total };
  });

  app.get('/invitations/:id', async (req) => {
    getUser(req);
    const { id } = parse(idParams, req.params);
    const inv = await getInvitation(id);
    const [answers, proctoring] = await Promise.all([
      sql`
        select q.id as question_id, q.position, q.prompt, q.type, q.options, q.correct_options, q.points,
               a.response, a.is_correct, a.points_awarded, a.ai_feedback
        from assessment.questions q
        left join assessment.answers a on a.question_id = q.id and a.invitation_id = ${id}
        where q.test_id = ${inv.testId as string}
        order by q.position
      `,
      proctoringSummary(sql, id),
    ]);
    return { ...inv, answers, proctoring };
  });

  app.post('/invitations/:id/cancel', async (req) => {
    requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const [row] = await sql`update assessment.invitations set status = 'cancelled' where id = ${id} and status in ('invited', 'started') returning id`;
    if (!row) {
      await getInvitation(id);
      throw conflict('Only pending or in-progress invitations can be cancelled');
    }
    return getInvitation(id);
  });

  app.post('/invitations/:id/resend', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const { expiresInDays } = parse(z.object({ expiresInDays: z.coerce.number().int().min(1).max(30).default(3) }), req.body ?? {});
    const { token, hash } = createToken();
    const expiresAt = addDays(expiresInDays);
    const [row] = await sql<{ id: string; candidateId: string; candidateName: string; candidateEmail: string; jobId: string | null; testId: string }[]>`
      update assessment.invitations
      set token_hash = ${hash}, expires_at = ${expiresAt}, status = 'invited', started_at = null, deadline_at = null
      where id = ${id} and status in ('invited', 'expired', 'cancelled')
      returning id, candidate_id, candidate_name, candidate_email, job_id, test_id
    `;
    if (!row) {
      await getInvitation(id);
      throw conflict('This candidate has already started or completed the test');
    }
    const [test] = await sql<{ title: string; durationMin: number }[]>`select title, duration_min from assessment.tests where id = ${row.testId}`;
    const job = await jobLookup()(row.jobId);
    await sendInviteEmail({ ...row, expiresAt }, token, test!, job?.title ?? 'the role', user.id, req.log);
    return getInvitation(id);
  });

  app.post('/invitations/:id/regrade', async (req) => {
    requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const inv = await getInvitation(id);
    if (!['submitted', 'graded'].includes(inv.status as string)) throw conflict('Only submitted tests can be graded');
    await gradeInvitation(id, req.log);
    return getInvitation(id);
  });
}
