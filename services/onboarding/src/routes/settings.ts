import type { FastifyInstance } from 'fastify';
import { defined, email, idParams, notFound, optionalText, parse, requireRole, z } from '@hireflow/shared';
import { sql } from '../db.js';

const vendorBody = z.object({
  name: z.string().trim().min(1).max(200),
  contactName: optionalText(200),
  contactEmail: email,
  isActive: z.boolean().optional(),
});

const docTypeBody = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{2,50}$/, 'Use lowercase letters, numbers and underscores'),
  name: z.string().trim().min(1).max(200),
  description: optionalText(1000),
  isRequired: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

export async function settingsRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------- BGV vendors
  app.get('/bgv-vendors', async () => {
    const data = await sql`
      select id, name, contact_name, contact_email, is_active, created_at
      from onboarding.bgv_vendors order by is_active desc, name
    `;
    return { data, total: data.length };
  });

  app.post('/bgv-vendors', async (req) => {
    requireRole(req, 'recruiter');
    const body = parse(vendorBody, req.body);
    const [v] = await sql`
      insert into onboarding.bgv_vendors ${sql({ name: body.name, contactName: body.contactName ?? null, contactEmail: body.contactEmail, isActive: body.isActive ?? true })}
      returning id, name, contact_name, contact_email, is_active, created_at
    `;
    return v;
  });

  app.patch('/bgv-vendors/:id', async (req) => {
    requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const patch = defined(parse(vendorBody.partial(), req.body));
    const [v] = Object.keys(patch).length
      ? await sql`
          update onboarding.bgv_vendors set ${sql(patch)} where id = ${id}
          returning id, name, contact_name, contact_email, is_active, created_at
        `
      : await sql`select id, name, contact_name, contact_email, is_active, created_at from onboarding.bgv_vendors where id = ${id}`;
    if (!v) throw notFound('Vendor');
    return v;
  });

  // ---------------------------------------------------------------- document types
  app.get('/document-types', async () => {
    const data = await sql`
      select id, code, name, description, is_required, sort_order, is_active
      from onboarding.document_types order by sort_order, name
    `;
    return { data, total: data.length };
  });

  app.post('/document-types', async (req) => {
    requireRole(req, 'recruiter');
    const body = parse(docTypeBody, req.body);
    const [t] = await sql`
      insert into onboarding.document_types ${sql({ ...body, description: body.description ?? null })}
      returning id, code, name, description, is_required, sort_order, is_active
    `;
    return t;
  });

  app.patch('/document-types/:id', async (req) => {
    requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const raw = (req.body ?? {}) as Record<string, unknown>;
    // .partial() keeps defaults out, so only provided keys are updated
    const patch = defined(parse(docTypeBody.partial(), raw));
    for (const k of Object.keys(patch)) if (!(k in raw)) delete (patch as Record<string, unknown>)[k];
    const [t] = Object.keys(patch).length
      ? await sql`
          update onboarding.document_types set ${sql(patch)} where id = ${id}
          returning id, code, name, description, is_required, sort_order, is_active
        `
      : await sql`select id, code, name, description, is_required, sort_order, is_active from onboarding.document_types where id = ${id}`;
    if (!t) throw notFound('Document type');
    return t;
  });
}
