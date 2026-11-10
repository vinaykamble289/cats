import type { FastifyInstance } from 'fastify';
import {
  badRequest,
  email,
  getUser,
  idParams,
  notFound,
  orNotFound,
  paginationQuery,
  parse,
  requireRole,
  toLimitOffset,
  z,
} from '@hireflow/shared';
import { sql } from '../db.js';
import { renderTemplate, wrapLayout } from '../render.js';

const attachmentSchema = z.object({
  filename: z.string().min(1).max(200),
  content: z.string().max(1_000_000),
  contentType: z.string().min(1).max(100),
});

const queueSchema = z.object({
  templateKey: z.string().min(1).max(100),
  to: email,
  cc: z.array(email).max(20).default([]),
  data: z.record(z.unknown()).default({}),
  relatedType: z.string().max(50).nullish(),
  relatedId: z.string().uuid().nullish(),
  candidateId: z.string().uuid().nullish(),
  attachments: z.array(attachmentSchema).max(5).default([]),
  createdBy: z.string().uuid().nullish(),
});

/** Renders a template and inserts the email into the outbox. */
export async function enqueueEmail(input: z.infer<typeof queueSchema>): Promise<{ id: string }> {
  const [tpl] = await sql<{ subject: string; bodyHtml: string }[]>`select subject, body_html from notify.templates where key = ${input.templateKey}`;
  if (!tpl) throw badRequest(`Unknown email template "${input.templateKey}"`);
  const subject = renderTemplate(tpl.subject, input.data, false).replace(/[\r\n]+/g, ' ').trim().slice(0, 250) || '(no subject)';
  const html = wrapLayout(renderTemplate(tpl.bodyHtml, input.data, true), subject);
  const [row] = await sql<{ id: string }[]>`
    insert into notify.emails (to_email, cc, subject, body_html, template_key, related_type, related_id, candidate_id, attachments, created_by)
    values (${input.to}, ${sql.array(input.cc)}::text[], ${subject}, ${html}, ${input.templateKey}, ${input.relatedType ?? null},
            ${input.relatedId ?? null}, ${input.candidateId ?? null}, ${sql.json(input.attachments)}, ${input.createdBy ?? null})
    returning id`;
  return row;
}

const listColumns = sql`id, to_email, cc, subject, template_key, status, attempts, last_error, related_type, related_id, candidate_id, created_at, sent_at`;

export async function emailRoutes(app: FastifyInstance) {
  app.post('/internal/emails', async (req, reply) => {
    const input = parse(queueSchema, req.body);
    return reply.status(201).send(await enqueueEmail(input));
  });

  app.get('/emails', async (req) => {
    getUser(req);
    const q = parse(
      paginationQuery.extend({
        candidateId: z.string().uuid().optional(),
        status: z.enum(['queued', 'sending', 'sent', 'failed']).optional(),
        relatedId: z.string().uuid().optional(),
        q: z.string().trim().max(100).optional(),
      }),
      req.query,
    );
    const { limit, offset } = toLimitOffset(q);
    const term = q.q ? `%${q.q}%` : null;
    const where = sql`
      where true
      ${q.candidateId ? sql`and candidate_id = ${q.candidateId}` : sql``}
      ${q.status ? sql`and status = ${q.status}` : sql``}
      ${q.relatedId ? sql`and related_id = ${q.relatedId}` : sql``}
      ${term ? sql`and (to_email ilike ${term} or subject ilike ${term})` : sql``}
    `;
    const [data, [{ total }]] = await Promise.all([
      sql`select ${listColumns} from notify.emails ${where} order by created_at desc limit ${limit} offset ${offset}`,
      sql<{ total: number }[]>`select count(*)::int as total from notify.emails ${where}`,
    ]);
    return { data, total };
  });

  app.get('/emails/:id', async (req) => {
    getUser(req);
    const { id } = parse(idParams, req.params);
    const [row] = await sql`select ${listColumns}, body_html from notify.emails where id = ${id}`;
    return orNotFound(row, 'Email');
  });

  /** Recruiter-composed message, delivered through the `generic` template. */
  app.post('/emails', async (req, reply) => {
    const user = requireRole(req, 'recruiter');
    const b = parse(
      z.object({
        to: email,
        cc: z.array(email).max(20).default([]),
        subject: z.string().trim().min(1).max(250),
        bodyHtml: z.string().min(1).max(100_000),
        candidateId: z.string().uuid().nullish(),
      }),
      req.body,
    );
    const res = await enqueueEmail({
      templateKey: 'generic',
      to: b.to,
      cc: b.cc,
      data: { subject: b.subject, bodyHtml: b.bodyHtml },
      candidateId: b.candidateId ?? null,
      relatedType: 'manual',
      attachments: [],
      createdBy: user.id,
    });
    return reply.status(201).send(res);
  });

  app.post('/emails/:id/retry', async (req) => {
    requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const [row] = await sql<{ id: string; status: string }[]>`
      update notify.emails set status = 'queued', attempts = 0, next_attempt_at = now(), last_error = null
      where id = ${id} and status = 'failed'
      returning id, status`;
    if (!row) {
      const [exists] = await sql`select 1 from notify.emails where id = ${id}`;
      if (!exists) throw notFound('Email');
      throw badRequest('Only failed emails can be retried');
    }
    return { ok: true };
  });
}
