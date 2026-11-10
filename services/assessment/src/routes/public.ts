import type { FastifyInstance } from 'fastify';
import { AppError, badRequest, env, hashToken, notFound, parse, publishEvent, z } from '@hireflow/shared';
import { sql } from '../db.js';
import { scheduleGrading } from '../lib/grading.js';
import { PROCTOR_TYPES } from '../lib/proctoring.js';
import { normalizeResponse, shuffleFor, type QuestionType } from '../lib/questions.js';

const GRACE_MS = 60_000;

interface InvitationRow {
  id: string;
  testId: string;
  applicationId: string;
  candidateId: string;
  jobId: string | null;
  candidateName: string;
  status: string;
  expiresAt: Date;
  startedAt: Date | null;
  deadlineAt: Date | null;
  submittedAt: Date | null;
  title: string;
  description: string | null;
  durationMin: number;
  shuffleQuestions: boolean;
  proctoringEnabled: boolean;
  questionCount: number;
}

const tokenParams = z.object({ token: z.string().min(20).max(200) });

async function loadByToken(token: string): Promise<InvitationRow> {
  const [inv] = await sql<InvitationRow[]>`
    select i.id, i.test_id, i.application_id, i.candidate_id, i.job_id, i.candidate_name, i.status, i.expires_at,
           i.started_at, i.deadline_at, i.submitted_at,
           t.title, t.description, t.duration_min, t.shuffle_questions, t.proctoring_enabled,
           (select count(*)::int from assessment.questions q where q.test_id = t.id) as question_count
    from assessment.invitations i join assessment.tests t on t.id = i.test_id
    where i.token_hash = ${hashToken(token)}
  `;
  if (!inv) throw notFound('Assessment link');
  // lazy expiry so the candidate gets an accurate status even before the worker runs
  if (inv.status === 'invited' && inv.expiresAt.getTime() < Date.now()) {
    await sql`update assessment.invitations set status = 'expired' where id = ${inv.id} and status = 'invited'`;
    inv.status = 'expired';
  }
  return inv;
}

async function payload(inv: InvitationRow) {
  const base = {
    status: inv.status,
    candidateName: inv.candidateName,
    companyName: env.companyName,
    expiresAt: inv.expiresAt,
    startedAt: inv.startedAt,
    deadlineAt: inv.deadlineAt,
    serverTime: new Date(),
    test: {
      title: inv.title,
      description: inv.description,
      durationMin: inv.durationMin,
      questionCount: inv.questionCount,
      proctoringEnabled: inv.proctoringEnabled,
    },
  };
  if (inv.status !== 'started') return base;
  const [questions, answers] = await Promise.all([
    sql<{ id: string; position: number; type: string; prompt: string; options: string[]; points: number }[]>`
      select id, position, type, prompt, options, points from assessment.questions where test_id = ${inv.testId} order by position
    `,
    sql<{ questionId: string; response: unknown }[]>`select question_id, response from assessment.answers where invitation_id = ${inv.id}`,
  ]);
  const ordered = inv.shuffleQuestions ? shuffleFor(questions, inv.id) : questions;
  return {
    ...base,
    questions: ordered.map((q, i) => ({ ...q, position: i + 1 })),
    answers: Object.fromEntries(answers.map((a) => [a.questionId, a.response])),
  };
}

const answersSchema = z.array(z.object({ questionId: z.string().uuid(), response: z.unknown() })).max(200);

/** Upserts answers after validating each against its question. */
async function saveAnswers(inv: InvitationRow, answers: z.infer<typeof answersSchema>) {
  if (!answers.length) return;
  const qs = await sql<{ id: string; type: QuestionType; options: string[] }[]>`
    select id, type, options from assessment.questions where test_id = ${inv.testId}
  `;
  const byId = new Map(qs.map((q) => [q.id, q]));
  await sql.begin(async (tx) => {
    for (const a of answers) {
      const q = byId.get(a.questionId);
      if (!q) throw badRequest('Unknown question');
      let value: unknown;
      try {
        value = normalizeResponse(q.type, q.options.length, a.response);
      } catch (err) {
        throw badRequest(`Invalid answer: ${(err as Error).message}`);
      }
      if (value === null) {
        await tx`delete from assessment.answers where invitation_id = ${inv.id} and question_id = ${q.id}`;
        continue;
      }
      await tx`
        insert into assessment.answers (invitation_id, question_id, response)
        values (${inv.id}, ${q.id}, ${tx.json(value as never)})
        on conflict (invitation_id, question_id) do update set response = excluded.response, answered_at = now()
      `;
    }
  });
}

function assertWritable(inv: InvitationRow) {
  if (inv.status !== 'started') throw new AppError(409, inv.status === 'invited' ? 'The test has not been started yet' : 'This test is no longer open for answers', 'TEST_CLOSED');
  if (inv.deadlineAt && Date.now() > inv.deadlineAt.getTime() + GRACE_MS) throw new AppError(409, 'Time is up - the test has ended', 'TIME_UP');
}

export async function publicRoutes(app: FastifyInstance) {
  app.get('/public/assessment/:token', async (req) => {
    const { token } = parse(tokenParams, req.params);
    return payload(await loadByToken(token));
  });

  app.post('/public/assessment/:token/start', async (req) => {
    const { token } = parse(tokenParams, req.params);
    const inv = await loadByToken(token);
    if (inv.status === 'invited') {
      if (!inv.questionCount) throw new AppError(409, 'This test is not ready yet. Please contact the recruiter.', 'TEST_EMPTY');
      const [row] = await sql<{ startedAt: Date; deadlineAt: Date }[]>`
        update assessment.invitations
        set status = 'started', started_at = now(), deadline_at = now() + make_interval(mins => ${inv.durationMin})
        where id = ${inv.id} and status = 'invited'
        returning started_at, deadline_at
      `;
      if (row) {
        inv.status = 'started';
        inv.startedAt = row.startedAt;
        inv.deadlineAt = row.deadlineAt;
        await publishEvent(sql, {
          type: 'assessment.started',
          aggregateType: 'invitation',
          aggregateId: inv.id,
          candidateId: inv.candidateId,
          jobId: inv.jobId,
          applicationId: inv.applicationId,
          payload: { candidateName: inv.candidateName, testTitle: inv.title },
        });
      } else {
        return payload(await loadByToken(token));
      }
    }
    return payload(inv);
  });

  app.put('/public/assessment/:token/answers', async (req) => {
    const { token } = parse(tokenParams, req.params);
    const { answers } = parse(z.object({ answers: answersSchema }), req.body);
    const inv = await loadByToken(token);
    assertWritable(inv);
    await saveAnswers(inv, answers);
    return { ok: true, savedAt: new Date() };
  });

  app.post('/public/assessment/:token/submit', async (req) => {
    const { token } = parse(tokenParams, req.params);
    const { answers } = parse(z.object({ answers: answersSchema.optional() }), req.body ?? {});
    const inv = await loadByToken(token);
    if (inv.status === 'submitted' || inv.status === 'graded') return { ok: true };
    assertWritable(inv);
    if (answers?.length) await saveAnswers(inv, answers);
    const [row] = await sql`
      update assessment.invitations set status = 'submitted', submitted_at = now()
      where id = ${inv.id} and status = 'started' returning id
    `;
    if (row) {
      await publishEvent(sql, {
        type: 'assessment.submitted',
        aggregateType: 'invitation',
        aggregateId: inv.id,
        candidateId: inv.candidateId,
        jobId: inv.jobId,
        applicationId: inv.applicationId,
        payload: { candidateName: inv.candidateName, testTitle: inv.title },
      });
      scheduleGrading(inv.id, req.log);
    }
    return { ok: true };
  });

  app.post('/public/assessment/:token/proctor', async (req) => {
    const { token } = parse(tokenParams, req.params);
    const { events } = parse(
      z.object({
        events: z
          .array(z.object({ type: z.string().max(50), details: z.record(z.unknown()).optional(), at: z.string().max(40).optional() }))
          .max(100),
      }),
      req.body,
    );
    const inv = await loadByToken(token);
    if (inv.status !== 'started' && inv.status !== 'invited') return { ok: true, recorded: 0 };
    const valid = events.filter((e) => PROCTOR_TYPES.includes(e.type));
    if (valid.length) {
      await sql`
        insert into assessment.proctor_events (invitation_id, event_type, details)
        select ${inv.id}, t, d::jsonb
        from unnest(${valid.map((e) => e.type)}::text[], ${valid.map((e) => JSON.stringify({ ...(e.details ?? {}), clientAt: e.at ?? null }).slice(0, 2000))}::text[]) as x(t, d)
      `;
    }
    return { ok: true, recorded: valid.length };
  });
}
