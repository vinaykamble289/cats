import type { FastifyInstance } from 'fastify';
import {
  addDays,
  badRequest,
  callService,
  conflict,
  createToken,
  csvList,
  defined,
  env,
  formatDate,
  idParams,
  notFound,
  optionalText,
  paginationQuery,
  parse,
  portalUrl,
  publishEvent,
  queueEmailSafe,
  requireRole,
  toLimitOffset,
  uuid,
  z,
  type ApplicationContext,
  type JobContext,
} from '@hireflow/shared';
import { sql } from '../db.js';
import { acceptOffer, currentVersion, escapeHtml, eventBase, getOffer, messagesFor, updateApplication, versionCols, withCurrent, type Row } from '../lib/offers.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const money = z.number().min(0).max(1e12);

const versionFields = {
  designation: z.string().trim().min(1).max(200),
  baseSalary: money,
  variablePay: money.optional(),
  joiningBonus: money.optional(),
  equity: optionalText(500),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  joiningDate: isoDate.nullish(),
  location: optionalText(200),
  benefits: optionalText(5000),
  additionalTerms: optionalText(5000),
};

const createBody = z.object({ applicationId: uuid, ...versionFields });
const patchBody = z.object(versionFields).partial();
const reviseBody = z.object(versionFields).partial().extend({ message: optionalText(5000) });

const listQuery = paginationQuery.extend({
  status: csvList,
  jobId: uuid.optional(),
  applicationId: uuid.optional(),
  candidateId: uuid.optional(),
});

const VERSION_KEYS = ['designation', 'baseSalary', 'variablePay', 'joiningBonus', 'equity', 'currency', 'joiningDate', 'location', 'benefits', 'additionalTerms'] as const;

function pickVersion(src: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of VERSION_KEYS) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

async function emailOffer(o: Row, template: 'offer_sent' | 'offer_revised', token: string, actorId: string, log: FastifyInstance['log']) {
  const v = await currentVersion(sql, o);
  await queueEmailSafe(
    {
      templateKey: template,
      to: o.candidateEmail,
      data: {
        candidateName: o.candidateName,
        jobTitle: o.jobTitle,
        designation: v.designation,
        link: portalUrl('offer', token),
        expiresAt: o.expiresAt ? formatDate(o.expiresAt) : '',
      },
      relatedType: 'offer',
      relatedId: o.id,
      candidateId: o.candidateId,
      createdBy: actorId,
    },
    log,
  );
}

export async function offerRoutes(app: FastifyInstance) {
  app.get('/offers', async (req) => {
    const q = parse(listQuery, req.query);
    const { limit, offset } = toLimitOffset(q);
    const conds = [sql`true`];
    if (q.status?.length) conds.push(sql`o.status::text = any(${q.status})`);
    if (q.jobId) conds.push(sql`o.job_id = ${q.jobId}`);
    if (q.applicationId) conds.push(sql`o.application_id = ${q.applicationId}`);
    if (q.candidateId) conds.push(sql`o.candidate_id = ${q.candidateId}`);
    const where = conds.reduce((a, b) => sql`${a} and ${b}`);
    const [rows, [{ total }]] = await Promise.all([
      sql`select o.* from offer.offers o where ${where} order by o.updated_at desc limit ${limit} offset ${offset}`,
      sql`select count(*)::int as total from offer.offers o where ${where}`,
    ]);
    return { data: await withCurrent(sql, rows), total };
  });

  app.get('/offers/stats', async () => {
    const rows = await sql`select status::text as status, count(*)::int as count from offer.offers group by status`;
    const byStatus: Record<string, number> = Object.fromEntries(rows.map((r) => [r.status, r.count]));
    const decided = (byStatus.accepted ?? 0) + (byStatus.declined ?? 0) + (byStatus.expired ?? 0);
    return { byStatus, acceptanceRate: decided ? Math.round(((byStatus.accepted ?? 0) / decided) * 100) : null };
  });

  app.post('/offers', async (req) => {
    const user = requireRole(req, 'recruiter');
    const body = parse(createBody, req.body);
    const appCtx = await callService<ApplicationContext>('talent', `/internal/applications/${body.applicationId}`);
    if (appCtx.status !== 'active') throw badRequest(`The application is ${appCtx.status}`);
    const job = await callService<JobContext>('jobs', `/internal/jobs/${appCtx.jobId}`);

    const id = await sql.begin(async (tx) => {
      const [open] = await tx`
        select id from offer.offers where application_id = ${body.applicationId} and status not in ('declined', 'withdrawn', 'expired')
      `;
      if (open) throw conflict('This candidate already has an open offer for this job', { offerId: open.id });
      const [o] = await tx`
        insert into offer.offers ${tx({
          applicationId: body.applicationId,
          candidateId: appCtx.candidateId,
          jobId: job.id,
          candidateName: appCtx.candidateName,
          candidateEmail: appCtx.candidateEmail,
          jobTitle: job.title,
          createdBy: user.id,
        })}
        returning *
      `;
      await tx`
        insert into offer.offer_versions ${tx({
          offerId: o.id,
          version: 1,
          designation: body.designation,
          baseSalary: body.baseSalary,
          variablePay: body.variablePay ?? 0,
          joiningBonus: body.joiningBonus ?? 0,
          equity: body.equity ?? null,
          currency: body.currency ?? job.currency ?? env.defaultCurrency,
          joiningDate: body.joiningDate ?? null,
          location: body.location ?? job.location ?? null,
          benefits: body.benefits ?? null,
          additionalTerms: body.additionalTerms ?? null,
          createdBy: user.id,
        })}
      `;
      await publishEvent(tx, {
        type: 'offer.created',
        ...eventBase(o),
        actorId: user.id,
        payload: { candidateName: o.candidateName, jobTitle: o.jobTitle, designation: body.designation, baseSalary: body.baseSalary },
      });
      return o.id as string;
    });
    return getOffer(sql, id);
  });

  app.get('/offers/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const offer = await getOffer(sql, id);
    const [versions, messages] = await Promise.all([
      sql`select ${versionCols()} from offer.offer_versions v where v.offer_id = ${id} order by v.version desc`,
      messagesFor(sql, id),
    ]);
    return { ...offer, versions, messages };
  });

  app.patch('/offers/:id', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const patch = defined(pickVersion(parse(patchBody, req.body)));
    await sql.begin(async (tx) => {
      const [o] = await tx`select * from offer.offers where id = ${id} for update`;
      if (!o) throw notFound('Offer');
      if (o.status !== 'draft') throw conflict('Only draft offers can be edited. Use "Revise" for sent offers.');
      if (Object.keys(patch).length) {
        await tx`update offer.offer_versions set ${tx(patch)} where offer_id = ${id} and version = ${o.currentVersion}`;
        await tx`update offer.offers set updated_at = now() where id = ${id}`;
      }
      await publishEvent(tx, { type: 'offer.updated', ...eventBase(o), actorId: user.id, payload: { candidateName: o.candidateName, jobTitle: o.jobTitle } });
    });
    return getOffer(sql, id);
  });

  app.post('/offers/:id/send', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const { expiresInDays } = parse(z.object({ expiresInDays: z.number().int().min(1).max(60).default(7) }), req.body);
    const { token, hash } = createToken();
    const offer = await sql.begin(async (tx) => {
      const [o] = await tx`select * from offer.offers where id = ${id} for update`;
      if (!o) throw notFound('Offer');
      if (!['draft', 'sent', 'negotiating', 'expired'].includes(o.status)) throw conflict(`This offer is ${o.status}`);
      const [u] = await tx`
        update offer.offers
        set status = 'sent', token_hash = ${hash}, expires_at = ${addDays(expiresInDays)}, sent_at = now()
        where id = ${id} returning *
      `;
      await publishEvent(tx, {
        type: 'offer.sent',
        ...eventBase(u),
        actorId: user.id,
        payload: { candidateName: u.candidateName, jobTitle: u.jobTitle, version: u.currentVersion },
      });
      return u;
    });
    await updateApplication(offer.applicationId, { stage: 'offer', note: 'Offer sent', actorId: user.id }, req.log);
    await emailOffer(offer, 'offer_sent', token, user.id, req.log);
    return getOffer(sql, id);
  });

  app.post('/offers/:id/revise', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const body = parse(reviseBody, req.body);
    const changes = defined(pickVersion(body));
    const { token, hash } = createToken();

    const { offer, resend } = await sql.begin(async (tx) => {
      const [o] = await tx`select * from offer.offers where id = ${id} for update`;
      if (!o) throw notFound('Offer');
      if (!['draft', 'sent', 'negotiating', 'expired'].includes(o.status)) throw conflict(`This offer is ${o.status} and cannot be revised`);
      const cur = await currentVersion(tx, o);
      const nextVersion = o.currentVersion + 1;
      const merged = { ...pickVersion(cur), ...changes };
      await tx`
        insert into offer.offer_versions ${tx({
          offerId: id,
          version: nextVersion,
          designation: merged.designation,
          baseSalary: merged.baseSalary,
          variablePay: merged.variablePay ?? 0,
          joiningBonus: merged.joiningBonus ?? 0,
          equity: merged.equity ?? null,
          currency: merged.currency,
          joiningDate: merged.joiningDate ?? null,
          location: merged.location ?? null,
          benefits: merged.benefits ?? null,
          additionalTerms: merged.additionalTerms ?? null,
          createdBy: user.id,
        } as Record<string, unknown>)}
      `;
      const resend = o.status !== 'draft';
      // Sent offers get a fresh link (only token hashes are stored) and an extended validity.
      const [u] = resend
        ? await tx`
            update offer.offers
            set current_version = ${nextVersion}, status = 'sent', token_hash = ${hash},
                expires_at = greatest(coalesce(expires_at, now()), now() + interval '7 days'), sent_at = now()
            where id = ${id} returning *
          `
        : await tx`update offer.offers set current_version = ${nextVersion} where id = ${id} returning *`;
      if (body.message) {
        await tx`
          insert into offer.negotiation_messages ${tx({ offerId: id, actor: 'recruiter', authorId: user.id, message: body.message, offerVersion: nextVersion })}
        `;
      }
      await publishEvent(tx, {
        type: 'offer.revised',
        ...eventBase(u),
        actorId: user.id,
        payload: { candidateName: u.candidateName, jobTitle: u.jobTitle, version: nextVersion, baseSalary: merged.baseSalary },
      });
      return { offer: u, resend };
    });
    if (resend) await emailOffer(offer, 'offer_revised', token, user.id, req.log);
    return getOffer(sql, id);
  });

  app.post('/offers/:id/messages', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const { message } = parse(z.object({ message: z.string().trim().min(1).max(5000) }), req.body);
    const offer = await sql.begin(async (tx) => {
      const [o] = await tx`select * from offer.offers where id = ${id} for update`;
      if (!o) throw notFound('Offer');
      await tx`
        insert into offer.negotiation_messages ${tx({ offerId: id, actor: 'recruiter', authorId: user.id, message, offerVersion: o.currentVersion })}
      `;
      await tx`update offer.offers set updated_at = now() where id = ${id}`;
      await publishEvent(tx, { type: 'offer.message', ...eventBase(o), actorId: user.id, payload: { candidateName: o.candidateName, jobTitle: o.jobTitle } });
      return o;
    });
    await queueEmailSafe(
      {
        templateKey: 'generic',
        to: offer.candidateEmail,
        data: {
          subject: `Regarding your offer for ${offer.jobTitle}`,
          bodyHtml: `<p>Hi ${escapeHtml(offer.candidateName)},</p><p>${escapeHtml(message).replace(/\n/g, '<br/>')}</p><p>Best regards,<br/>${escapeHtml(user.name || env.companyName)}</p>`,
        },
        relatedType: 'offer',
        relatedId: offer.id,
        candidateId: offer.candidateId,
        createdBy: user.id,
      },
      req.log,
    );
    return { ...(await getOffer(sql, id)), messages: await messagesFor(sql, id) };
  });

  app.post('/offers/:id/withdraw', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const { reason } = parse(z.object({ reason: optionalText(2000) }), req.body);
    await sql.begin(async (tx) => {
      const [o] = await tx`select * from offer.offers where id = ${id} for update`;
      if (!o) throw notFound('Offer');
      if (!['draft', 'sent', 'negotiating', 'expired'].includes(o.status)) throw conflict(`This offer is ${o.status}`);
      await tx`update offer.offers set status = 'withdrawn', decline_reason = ${reason ?? null}, token_hash = null where id = ${id}`;
      await publishEvent(tx, {
        type: 'offer.withdrawn',
        ...eventBase(o),
        actorId: user.id,
        payload: { candidateName: o.candidateName, jobTitle: o.jobTitle, reason: reason ?? null },
      });
    });
    return getOffer(sql, id);
  });

  app.post('/offers/:id/mark-accepted', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const { joiningDate } = parse(z.object({ joiningDate: isoDate.nullish() }), req.body);
    await acceptOffer(id, { joiningDate, actorId: user.id, allowed: ['draft', 'sent', 'negotiating', 'expired'] }, req.log);
    return getOffer(sql, id);
  });
}
