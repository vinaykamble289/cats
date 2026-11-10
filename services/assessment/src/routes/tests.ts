import type { FastifyInstance } from 'fastify';
import { badRequest, callService, csvList, defined, getUser, idParams, optionalText, orNotFound, parse, requireRole, z } from '@hireflow/shared';
import { sql } from '../db.js';
import { jobLookup } from '../lib/context.js';
import { assertQuestionsEditable, insertQuestions, QUESTION_TYPES, questionSchema, type QuestionInput } from '../lib/questions.js';

const testFields = {
  title: z.string().trim().min(1).max(200),
  description: optionalText(5000),
  jobId: z.string().uuid().nullish(),
  durationMin: z.coerce.number().int().min(5).max(300),
  passPercent: z.coerce.number().int().min(0).max(100),
  shuffleQuestions: z.boolean(),
  proctoringEnabled: z.boolean(),
  status: z.enum(['draft', 'active', 'archived']),
};

const testSummary = sql`
  t.id, t.title, t.description, t.job_id, t.duration_min, t.pass_percent, t.shuffle_questions, t.proctoring_enabled,
  t.status, t.created_by, t.created_at, t.updated_at,
  coalesce(q.cnt, 0) as question_count, coalesce(q.pts, 0) as total_points, coalesce(i.cnt, 0) as invitation_count
`;
const testJoins = sql`
  left join lateral (select count(*)::int as cnt, coalesce(sum(points), 0)::int as pts from assessment.questions where test_id = t.id) q on true
  left join lateral (select count(*)::int as cnt from assessment.invitations where test_id = t.id) i on true
`;

export async function getTestDetail(id: string) {
  const [test] = await sql`select ${testSummary} from assessment.tests t ${testJoins} where t.id = ${id}`;
  orNotFound(test, 'Test');
  const questions = await sql`
    select id, position, type, prompt, options, correct_options, points, rubric
    from assessment.questions where test_id = ${id} order by position
  `;
  return { ...test, questions };
}

export async function testRoutes(app: FastifyInstance) {
  app.get('/tests', async (req) => {
    getUser(req);
    const q = parse(z.object({ jobId: z.string().uuid().optional(), status: csvList }), req.query);
    const statuses = q.status?.map((s) => parse(testFields.status, s));
    const data = await sql`
      select ${testSummary} from assessment.tests t ${testJoins}
      where true
      ${q.jobId ? sql`and t.job_id = ${q.jobId}` : sql``}
      ${statuses?.length ? sql`and t.status = any(${statuses}::assessment.test_status[])` : sql`and t.status <> 'archived'`}
      order by (t.status = 'active') desc, t.updated_at desc
    `;
    return { data, total: data.length };
  });

  app.post('/tests', async (req, reply) => {
    const user = requireRole(req, 'recruiter');
    const body = parse(
      z.object({
        ...testFields,
        durationMin: testFields.durationMin.default(45),
        passPercent: testFields.passPercent.default(60),
        shuffleQuestions: testFields.shuffleQuestions.default(false),
        proctoringEnabled: testFields.proctoringEnabled.default(true),
        status: testFields.status.default('draft'),
        questions: z.array(questionSchema).max(100).optional(),
      }),
      req.body,
    );
    const { questions, ...fields } = body;
    const id = await sql.begin(async (tx) => {
      const [t] = await tx<{ id: string }[]>`insert into assessment.tests ${tx(defined({ ...fields, createdBy: user.id }) as never)} returning id`;
      if (questions?.length) await insertQuestions(tx, t!.id, questions);
      return t!.id;
    });
    reply.status(201);
    return getTestDetail(id);
  });

  app.get('/tests/:id', async (req) => {
    getUser(req);
    const { id } = parse(idParams, req.params);
    return getTestDetail(id);
  });

  app.patch('/tests/:id', async (req) => {
    requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const body = parse(z.object(testFields).partial(), req.body);
    const update = defined(body);
    if (Object.keys(update).length) {
      const [t] = await sql`update assessment.tests set ${sql(update as never)} where id = ${id} returning id`;
      orNotFound(t, 'Test');
    }
    return getTestDetail(id);
  });

  app.delete('/tests/:id', async (req, reply) => {
    requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const [inv] = await sql<{ n: number }[]>`select count(*)::int as n from assessment.invitations where test_id = ${id}`;
    if (inv!.n > 0) {
      const [t] = await sql`update assessment.tests set status = 'archived' where id = ${id} returning id`;
      orNotFound(t, 'Test');
    } else {
      const [t] = await sql`delete from assessment.tests where id = ${id} returning id`;
      orNotFound(t, 'Test');
    }
    return reply.status(204).send();
  });

  app.put('/tests/:id/questions', async (req) => {
    requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const { questions } = parse(z.object({ questions: z.array(questionSchema).max(100) }), req.body);
    await sql.begin(async (tx) => {
      const [t] = await tx`select id from assessment.tests where id = ${id} for update`;
      orNotFound(t, 'Test');
      await assertQuestionsEditable(tx, id);
      await tx`delete from assessment.questions where test_id = ${id}`;
      await insertQuestions(tx, id, questions);
      await tx`update assessment.tests set updated_at = now() where id = ${id}`;
    });
    return getTestDetail(id);
  });

  app.post('/tests/:id/generate', async (req) => {
    requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({
        count: z.coerce.number().int().min(1).max(30).default(10),
        difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
        types: z.array(z.enum(QUESTION_TYPES)).min(1).optional(),
        topics: optionalText(2000),
        append: z.boolean().default(true),
      }),
      req.body,
    );
    const [test] = await sql<{ id: string; title: string; description: string | null; jobId: string | null }[]>`
      select id, title, description, job_id from assessment.tests where id = ${id}
    `;
    orNotFound(test, 'Test');
    const job = await jobLookup()(test!.jobId);
    const ai = await callService<{ questions: unknown[] }>('ai', '/internal/assessment/generate', {
      method: 'POST',
      timeoutMs: 120_000,
      body: {
        jobTitle: job?.title ?? test!.title,
        jobDescription: job?.description ?? test!.description ?? undefined,
        skills: job?.skills.map((s) => s.name) ?? [],
        count: body.count,
        difficulty: body.difficulty,
        types: body.types ?? ['mcq', 'mcq', 'mcq', 'short_text'],
        topics: body.topics ?? undefined,
      },
    });
    const valid: QuestionInput[] = [];
    for (const raw of ai.questions ?? []) {
      const r = questionSchema.safeParse(raw);
      if (r.success) valid.push(r.data);
    }
    if (!valid.length) throw badRequest('The AI did not return usable questions. Please try again or adjust the topics.');

    await sql.begin(async (tx) => {
      await tx`select id from assessment.tests where id = ${id} for update`;
      let start = 1;
      if (body.append) {
        const [m] = await tx<{ max: number }[]>`select coalesce(max(position), 0)::int as max from assessment.questions where test_id = ${id}`;
        start = m!.max + 1;
      } else {
        await assertQuestionsEditable(tx, id);
        await tx`delete from assessment.questions where test_id = ${id}`;
      }
      await insertQuestions(tx, id, valid, start);
      await tx`update assessment.tests set updated_at = now() where id = ${id}`;
    });
    return getTestDetail(id);
  });
}
