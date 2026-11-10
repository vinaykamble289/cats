import type { FastifyInstance } from 'fastify';
import { APPLICATION_STAGES, APPLICATION_STATUSES, idParams, optionalText, orNotFound, parse, z, type ApplicationContext } from '@hireflow/shared';
import { sql } from '../db.js';
import { candidateColumns, transitionApplication } from '../lib/applications.js';
import { jobTitles } from '../lib/jobs.js';

export async function internalRoutes(app: FastifyInstance) {
  app.get('/internal/applications/:id', async (req): Promise<ApplicationContext> => {
    const { id } = parse(idParams, req.params);
    const [row] = await sql<ApplicationContext[]>`
      select a.id, a.candidate_id, a.job_id, a.stage, a.status,
             c.full_name as candidate_name, c.email as candidate_email, c.phone as candidate_phone,
             (select r.text_content from talent.resumes r where r.candidate_id = c.id and r.is_primary limit 1) as resume_text
      from talent.applications a join talent.candidates c on c.id = a.candidate_id
      where a.id = ${id}
    `;
    return orNotFound(row, 'Application');
  });

  app.post('/internal/applications/:id/stage', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({
        stage: z.enum(APPLICATION_STAGES).optional(),
        status: z.enum(APPLICATION_STATUSES).optional(),
        note: optionalText(2000),
        actorId: z.string().uuid().nullish(),
      }),
      req.body,
    );
    const [current] = await sql<{ jobId: string }[]>`select job_id from talent.applications where id = ${id}`;
    orNotFound(current, 'Application');
    const titles = await jobTitles([current!.jobId]);
    const result = await sql.begin((tx) =>
      transitionApplication(tx, id, { stage: body.stage, status: body.status, note: body.note, actorId: body.actorId ?? null, jobTitle: titles.get(current!.jobId) ?? null }),
    );
    return { ok: true, changed: !!result?.changed };
  });

  app.get('/internal/candidates/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const [c] = await sql`select ${candidateColumns()} from talent.candidates c where c.id = ${id}`;
    return orNotFound(c, 'Candidate');
  });
}
