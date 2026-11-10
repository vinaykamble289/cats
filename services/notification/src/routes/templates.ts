import type { FastifyInstance } from 'fastify';
import { getUser, notFound, orNotFound, parse, requireRole, z } from '@hireflow/shared';
import { sql } from '../db.js';
import { renderTemplate, sampleData, wrapLayout } from '../render.js';

const keyParams = z.object({ key: z.string().min(1).max(100) });
const columns = sql`id, key, name, description, subject, body_html, updated_at`;

export async function templateRoutes(app: FastifyInstance) {
  app.get('/templates', async (req) => {
    getUser(req);
    const data = await sql`select ${columns} from notify.templates order by name`;
    return { data, total: data.length };
  });

  app.get('/templates/:key', async (req) => {
    getUser(req);
    const { key } = parse(keyParams, req.params);
    const [row] = await sql`select ${columns} from notify.templates where key = ${key}`;
    return orNotFound(row, 'Template');
  });

  app.put('/templates/:key', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { key } = parse(keyParams, req.params);
    const b = parse(
      z.object({
        subject: z.string().trim().min(1).max(250),
        bodyHtml: z.string().min(1).max(100_000),
        name: z.string().trim().min(1).max(120).optional(),
      }),
      req.body,
    );
    const [row] = await sql`
      update notify.templates set
        subject = ${b.subject},
        body_html = ${b.bodyHtml},
        name = coalesce(${b.name ?? null}, name),
        updated_by = ${user.id}
      where key = ${key}
      returning ${columns}`;
    if (!row) throw notFound('Template');
    return row;
  });

  app.post('/templates/:key/preview', async (req) => {
    getUser(req);
    const { key } = parse(keyParams, req.params);
    const b = parse(
      z.object({ data: z.record(z.unknown()).optional(), subject: z.string().max(250).optional(), bodyHtml: z.string().max(100_000).optional() }),
      req.body,
    );
    const [tpl] = await sql<{ subject: string; bodyHtml: string }[]>`select subject, body_html from notify.templates where key = ${key}`;
    if (!tpl) throw notFound('Template');
    // Allows previewing unsaved edits by passing subject/bodyHtml
    const data = { ...sampleData(), ...(b.data ?? {}) };
    const subject = renderTemplate(b.subject ?? tpl.subject, data, false);
    return { subject, html: wrapLayout(renderTemplate(b.bodyHtml ?? tpl.bodyHtml, data, true), subject) };
  });
}
