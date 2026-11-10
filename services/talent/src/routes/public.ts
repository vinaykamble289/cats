import type { FastifyInstance } from 'fastify';
import { AppError, badRequest, callService, conflict, email, notFound, parse, queueEmailSafe, z, type JobContext } from '@hireflow/shared';
import { sql } from '../db.js';
import { scheduleAiMatch } from '../lib/applications.js';
import { ingestResume } from '../lib/ingest.js';
import { readMultipart } from '../lib/multipart.js';

const blankToUndef = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optNum = (max: number) => z.preprocess(blankToUndef, z.coerce.number().min(0).max(max).optional());
const optStr = (max: number) => z.preprocess(blankToUndef, z.string().trim().max(max).optional());

const applySchema = z.object({
  fullName: z.string().trim().min(2, 'Please enter your full name').max(200),
  email,
  phone: optStr(40),
  location: optStr(200),
  linkedinUrl: optStr(500),
  experienceYears: optNum(80),
  noticePeriodDays: z.preprocess(blankToUndef, z.coerce.number().int().min(0).max(365).optional()),
  currentCtc: optNum(1e12),
  expectedCtc: optNum(1e12),
  coverNote: optStr(5000),
});

export async function publicRoutes(app: FastifyInstance) {
  app.post('/public/apply/:slug', async (req) => {
    const { slug } = parse(z.object({ slug: z.string().min(1).max(200) }), req.params);
    const job = await callService<JobContext>('jobs', `/internal/jobs/by-slug/${encodeURIComponent(slug)}`).catch((err) => {
      if (err instanceof AppError && err.statusCode === 404) throw notFound('Job');
      throw err;
    });
    if (job.status !== 'open') throw notFound('Job');

    const { fields, files } = await readMultipart(req);
    const body = parse(applySchema, fields);
    const resume = files.find((f) => f.fieldname === 'resume') ?? files[0];
    if (!resume) throw badRequest('Please attach your resume (PDF or DOCX)');

    const [already] = await sql`
      select 1 from talent.applications a join talent.candidates c on c.id = a.candidate_id
      where c.email = ${body.email} and a.job_id = ${job.id}
    `;
    if (already) throw conflict('You have already applied for this role. We will be in touch soon!');

    const result = await ingestResume({
      buffer: resume.buffer,
      fileName: resume.fileName,
      mimeType: resume.mimeType,
      source: 'career_page',
      sourceDetail: 'Careers page',
      job: { id: job.id, title: job.title },
      overrides: {
        fullName: body.fullName,
        email: body.email,
        phone: body.phone ?? null,
        location: body.location ?? null,
        linkedinUrl: body.linkedinUrl ?? null,
        experienceYears: body.experienceYears ?? null,
        noticePeriodDays: body.noticePeriodDays ?? null,
        currentCtc: body.currentCtc ?? null,
        expectedCtc: body.expectedCtc ?? null,
      },
      lenient: true,
      log: req.log,
    });

    if (body.coverNote) {
      await sql`insert into talent.notes (candidate_id, author_id, body) values (${result.candidateId}, null, ${`Cover note (${job.title}):\n${body.coverNote}`})`;
    }
    if (result.applicationId && result.applicationCreated) scheduleAiMatch([result.applicationId], req.log);
    await queueEmailSafe(
      {
        templateKey: 'application_received',
        to: result.candidateEmail,
        data: { candidateName: body.fullName, jobTitle: job.title },
        relatedType: 'application',
        relatedId: result.applicationId,
        candidateId: result.candidateId,
      },
      req.log,
    );
    return { ok: true };
  });
}
