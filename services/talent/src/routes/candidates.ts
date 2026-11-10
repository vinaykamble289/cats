import type { FastifyInstance } from 'fastify';
import {
  badRequest,
  conflict,
  csvList,
  defined,
  email,
  getUser,
  idParams,
  optionalText,
  orNotFound,
  paginationQuery,
  parse,
  publishEvent,
  removeFile,
  requireRole,
  signedUrl,
  toLimitOffset,
  z,
} from '@hireflow/shared';
import { sql } from '../db.js';
import { candidateColumns, createApplication, queryApplications, scheduleAiMatch } from '../lib/applications.js';
import { addSkills, ingestResume, mapLimit, type CandidateSource } from '../lib/ingest.js';
import { getJob } from '../lib/jobs.js';
import { readMultipart } from '../lib/multipart.js';

const SOURCES = ['career_page', 'manual_upload', 'bulk_upload', 'email', 'referral', 'linkedin', 'job_board', 'agency', 'other'] as const;

const num = (max: number) => z.coerce.number().min(0).max(max).nullish();
const url = z.string().trim().max(500).nullish().transform((v) => (v ? v : null));

const candidateBody = z.object({
  fullName: z.string().trim().min(1).max(200),
  email,
  phone: optionalText(40),
  location: optionalText(200),
  currentTitle: optionalText(200),
  currentCompany: optionalText(200),
  experienceYears: num(80),
  linkedinUrl: url,
  portfolioUrl: url,
  summary: optionalText(5000),
  source: z.enum(SOURCES).default('manual_upload'),
  sourceDetail: optionalText(300),
  noticePeriodDays: z.coerce.number().int().min(0).max(365).nullish(),
  currentCtc: num(1e12),
  expectedCtc: num(1e12),
  skills: z.array(z.string().trim().min(1).max(60)).max(100).optional(),
});

export async function candidateRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------- list
  app.get('/candidates', async (req) => {
    getUser(req);
    const q = parse(
      paginationQuery.extend({
        q: z.string().trim().max(200).optional(),
        skill: z.string().trim().max(60).optional(),
        source: csvList,
        jobId: z.string().uuid().optional(),
      }),
      req.query,
    );
    const { limit, offset } = toLimitOffset(q);
    const like = q.q ? `%${q.q.replace(/[%_]/g, '\\$&')}%` : null;
    const where = sql`
      ${q.q ? sql`and (c.search @@ plainto_tsquery('simple', ${q.q}) or c.full_name ilike ${like} or c.email ilike ${like}
                     or exists (select 1 from talent.candidate_skills s where s.candidate_id = c.id and lower(s.name) = lower(${q.q})))` : sql``}
      ${q.skill ? sql`and exists (select 1 from talent.candidate_skills s where s.candidate_id = c.id and lower(s.name) = lower(${q.skill}))` : sql``}
      ${q.source?.length ? sql`and c.source = any(${q.source}::talent.candidate_source[])` : sql``}
      ${q.jobId ? sql`and exists (select 1 from talent.applications a where a.candidate_id = c.id and a.job_id = ${q.jobId})` : sql``}
    `;
    const [data, [count]] = await Promise.all([
      sql`
        select ${candidateColumns()},
               (select count(*)::int from talent.applications a where a.candidate_id = c.id) as application_count
        from talent.candidates c
        where true ${where}
        order by c.created_at desc
        limit ${limit} offset ${offset}
      `,
      sql<{ total: number }[]>`select count(*)::int as total from talent.candidates c where true ${where}`,
    ]);
    return { data, total: count!.total };
  });

  // ---------------------------------------------------------------- create (manual)
  app.post('/candidates', async (req, reply) => {
    const user = requireRole(req, 'recruiter');
    const body = parse(candidateBody.extend({ jobId: z.string().uuid().optional() }), req.body);
    const job = body.jobId ? await getJob(body.jobId) : null;
    const [dup] = await sql<{ id: string }[]>`select id from talent.candidates where email = ${body.email}`;
    if (dup) throw conflict('A candidate with this email already exists', { candidateId: dup.id });

    const { skills, jobId: _jobId, ...fields } = body;
    const result = await sql.begin(async (tx) => {
      const [c] = await tx<{ id: string; fullName: string }[]>`
        insert into talent.candidates ${tx(defined({ ...fields, createdBy: user.id }) as never)}
        returning id, full_name
      `;
      await addSkills(tx, c!.id, skills ?? []);
      await publishEvent(tx, {
        type: 'candidate.created',
        aggregateType: 'candidate',
        aggregateId: c!.id,
        candidateId: c!.id,
        actorId: user.id,
        payload: { candidateName: c!.fullName, source: body.source },
      });
      const application = job
        ? await createApplication(tx, { candidateId: c!.id, candidateName: c!.fullName, jobId: job.id, jobTitle: job.title, actorId: user.id, source: body.source })
        : null;
      return { id: c!.id, applicationId: application?.id };
    });
    if (result.applicationId) scheduleAiMatch([result.applicationId], req.log);
    reply.status(201);
    return getCandidate(result.id);
  });

  // ---------------------------------------------------------------- resume upload (single / bulk)
  app.post('/candidates/upload', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { fields, files } = await readMultipart(req);
    if (!files.length) throw badRequest('Attach at least one resume file');
    if (files.length > 50) throw badRequest('Upload at most 50 resumes at a time');
    const jobId = fields.jobId ? parse(z.string().uuid(), fields.jobId) : undefined;
    const job = jobId ? await getJob(jobId) : null;
    const source: CandidateSource = fields.source && (SOURCES as readonly string[]).includes(fields.source) ? (fields.source as CandidateSource) : files.length > 1 ? 'bulk_upload' : 'manual_upload';

    const results = await mapLimit(files, 3, async (f) => {
      try {
        const r = await ingestResume({
          buffer: f.buffer,
          fileName: f.fileName,
          mimeType: f.mimeType,
          source,
          job: job ? { id: job.id, title: job.title } : null,
          actorId: user.id,
          log: req.log,
        });
        return { fileName: f.fileName, status: r.status, candidateId: r.candidateId, candidateName: r.candidateName, applicationId: r.applicationId, applicationCreated: r.applicationCreated };
      } catch (err) {
        return { fileName: f.fileName, status: 'failed' as const, error: (err as Error).message };
      }
    });
    scheduleAiMatch(
      results.filter((r) => 'applicationId' in r && r.applicationId && r.applicationCreated).map((r) => (r as { applicationId: string }).applicationId),
      req.log,
    );
    return { results: results.map(({ applicationCreated: _a, ...r }: Record<string, unknown>) => r) };
  });

  // ---------------------------------------------------------------- detail
  app.get('/candidates/:id', async (req) => {
    getUser(req);
    const { id } = parse(idParams, req.params);
    return getCandidate(id);
  });

  app.patch('/candidates/:id', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const body = parse(candidateBody.partial().omit({ source: true }).extend({ source: z.enum(SOURCES).optional() }), req.body);
    const { skills, ...fields } = body;
    const update = defined(fields);
    await sql.begin(async (tx) => {
      const [c] = await tx<{ id: string; fullName: string }[]>`
        update talent.candidates set ${Object.keys(update).length ? tx(update as never) : tx`updated_at = now()`}
        where id = ${id} returning id, full_name
      `;
      orNotFound(c, 'Candidate');
      if (skills) {
        await tx`delete from talent.candidate_skills where candidate_id = ${id}`;
        await addSkills(tx, id, skills);
      }
      await publishEvent(tx, {
        type: 'candidate.updated',
        aggregateType: 'candidate',
        aggregateId: id,
        candidateId: id,
        actorId: user.id,
        payload: { candidateName: c!.fullName, fields: Object.keys(body) },
      });
    });
    return getCandidate(id);
  });

  app.delete('/candidates/:id', async (req, reply) => {
    requireRole(req, 'admin');
    const { id } = parse(idParams, req.params);
    const resumes = await sql<{ storagePath: string }[]>`select storage_path from talent.resumes where candidate_id = ${id}`;
    const [deleted] = await sql`delete from talent.candidates where id = ${id} returning id`;
    orNotFound(deleted, 'Candidate');
    await Promise.all(resumes.map((r) => removeFile(r.storagePath).catch(() => {})));
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------- resume
  app.post('/candidates/:id/resume', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const [c] = await sql<{ email: string }[]>`select email from talent.candidates where id = ${id}`;
    orNotFound(c, 'Candidate');
    const { files } = await readMultipart(req);
    const file = files[0];
    if (!file) throw badRequest('Attach a resume file');
    // force the upload onto this candidate even if the resume shows another email
    await ingestResume({
      buffer: file.buffer,
      fileName: file.fileName,
      mimeType: file.mimeType,
      source: 'manual_upload',
      overrides: { email: c!.email },
      actorId: user.id,
      lenient: true,
      log: req.log,
    });
    return getCandidate(id);
  });

  app.get('/candidates/:id/resume/url', async (req) => {
    getUser(req);
    const { id } = parse(idParams, req.params);
    const [r] = await sql<{ storagePath: string; fileName: string }[]>`
      select storage_path, file_name from talent.resumes where candidate_id = ${id} and is_primary
    `;
    orNotFound(r, 'Resume');
    return { url: await signedUrl(r!.storagePath, 600), fileName: r!.fileName };
  });

  // ---------------------------------------------------------------- notes
  app.get('/candidates/:id/notes', async (req) => {
    getUser(req);
    const { id } = parse(idParams, req.params);
    const data = await sql`select id, author_id, body, created_at from talent.notes where candidate_id = ${id} order by created_at desc`;
    return { data, total: data.length };
  });

  app.post('/candidates/:id/notes', async (req, reply) => {
    const user = getUser(req);
    const { id } = parse(idParams, req.params);
    const { body } = parse(z.object({ body: z.string().trim().min(1).max(10_000) }), req.body);
    const [c] = await sql`select 1 from talent.candidates where id = ${id}`;
    orNotFound(c, 'Candidate');
    const [note] = await sql`
      insert into talent.notes (candidate_id, author_id, body) values (${id}, ${user.id}, ${body})
      returning id, author_id, body, created_at
    `;
    reply.status(201);
    return note;
  });
}

export async function getCandidate(id: string) {
  const [c] = await sql`select ${candidateColumns()} from talent.candidates c where c.id = ${id}`;
  orNotFound(c, 'Candidate');
  const [[resume], applications] = await Promise.all([
    sql`
      select id, file_name, mime_type, size_bytes, uploaded_at, parsed
      from talent.resumes where candidate_id = ${id} and is_primary
    `,
    queryApplications(sql`and a.candidate_id = ${id}`, { order: sql`order by a.applied_at desc` }),
  ]);
  return { ...c, resume: resume ?? null, applications };
}
