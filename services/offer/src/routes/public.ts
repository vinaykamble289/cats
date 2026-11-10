import type { FastifyInstance } from 'fastify';
import { conflict, env, gone, hashToken, notFound, optionalText, parse, publishEvent, z } from '@hireflow/shared';
import { sql } from '../db.js';
import { acceptOffer, currentVersion, eventBase, notifyRecruiter, updateApplication, type Row } from '../lib/offers.js';

const tokenParams = z.object({ token: z.string().min(20).max(200) });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const OPEN = ['sent', 'negotiating'];

async function findByToken(token: string): Promise<Row> {
  const [o] = await sql`select * from offer.offers where token_hash = ${hashToken(token)}`;
  if (!o) throw notFound('Offer');
  if (OPEN.includes(o.status) && o.expiresAt && new Date(o.expiresAt) < new Date()) {
    const [u] = await sql`update offer.offers set status = 'expired' where id = ${o.id} and status in ('sent', 'negotiating') returning *`;
    return u ?? { ...o, status: 'expired' };
  }
  return o;
}

function ensureOpen(o: Row) {
  if (o.status === 'expired') throw gone('This offer has expired. Please contact the recruiter.');
  if (o.status === 'withdrawn') throw gone('This offer is no longer available.');
  if (!OPEN.includes(o.status)) throw conflict(`You have already ${o.status} this offer.`);
}

export async function publicRoutes(app: FastifyInstance) {
  app.get('/public/offer/:token', async (req) => {
    const { token } = parse(tokenParams, req.params);
    const o = await findByToken(token);
    const [current, messages] = await Promise.all([
      currentVersion(sql, o),
      sql`
        select id, actor, message, requested_base_salary, requested_joining_date, offer_version, created_at
        from offer.negotiation_messages where offer_id = ${o.id} order by created_at
      `,
    ]);
    return {
      status: o.status,
      candidateName: o.candidateName,
      jobTitle: o.jobTitle,
      companyName: env.companyName,
      expiresAt: o.expiresAt,
      respondedAt: o.respondedAt,
      current,
      messages,
    };
  });

  app.post('/public/offer/:token/accept', async (req) => {
    const { token } = parse(tokenParams, req.params);
    const { joiningDate } = parse(z.object({ joiningDate: isoDate.nullish() }), req.body);
    const o = await findByToken(token);
    ensureOpen(o);
    await acceptOffer(o.id, { joiningDate, allowed: OPEN }, req.log);
    return { ok: true, status: 'accepted' };
  });

  app.post('/public/offer/:token/decline', async (req) => {
    const { token } = parse(tokenParams, req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(1).max(2000) }), req.body);
    const o = await findByToken(token);
    ensureOpen(o);
    const offer = await sql.begin(async (tx) => {
      const [u] = await tx`
        update offer.offers set status = 'declined', decline_reason = ${reason}, responded_at = now()
        where id = ${o.id} and status in ('sent', 'negotiating') returning *
      `;
      if (!u) throw conflict('This offer can no longer be declined.');
      await tx`insert into offer.negotiation_messages ${tx({ offerId: o.id, actor: 'candidate', message: `Declined: ${reason}`, offerVersion: u.currentVersion })}`;
      await publishEvent(tx, { type: 'offer.declined', ...eventBase(u), payload: { candidateName: u.candidateName, jobTitle: u.jobTitle, reason } });
      return u;
    });
    await updateApplication(offer.applicationId, { status: 'withdrawn', note: `Declined offer: ${reason}` }, req.log);
    await notifyRecruiter(offer, 'declined', `Reason: ${reason}`, req.log);
    return { ok: true, status: 'declined' };
  });

  app.post('/public/offer/:token/counter', async (req) => {
    const { token } = parse(tokenParams, req.params);
    const body = parse(
      z.object({
        message: z.string().trim().min(1).max(5000),
        requestedBaseSalary: z.number().min(0).max(1e12).nullish(),
        requestedJoiningDate: isoDate.nullish(),
      }),
      req.body,
    );
    const o = await findByToken(token);
    ensureOpen(o);
    const offer = await sql.begin(async (tx) => {
      const [u] = await tx`
        update offer.offers set status = 'negotiating' where id = ${o.id} and status in ('sent', 'negotiating') returning *
      `;
      if (!u) throw conflict('This offer can no longer be negotiated.');
      await tx`
        insert into offer.negotiation_messages ${tx({
          offerId: o.id,
          actor: 'candidate',
          message: body.message,
          requestedBaseSalary: body.requestedBaseSalary ?? null,
          requestedJoiningDate: body.requestedJoiningDate ?? null,
          offerVersion: u.currentVersion,
        })}
      `;
      await publishEvent(tx, {
        type: 'offer.countered',
        ...eventBase(u),
        payload: { candidateName: u.candidateName, jobTitle: u.jobTitle, requestedBaseSalary: body.requestedBaseSalary ?? null, requestedJoiningDate: body.requestedJoiningDate ?? null },
      });
      return u;
    });
    const details = [
      body.message,
      body.requestedBaseSalary ? `Requested base salary: ${body.requestedBaseSalary}` : '',
      body.requestedJoiningDate ? `Requested joining date: ${body.requestedJoiningDate}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    await notifyRecruiter(offer, 'requested changes to', details, req.log);
    return { ok: true, status: 'negotiating' };
  });
}
