import type { FastifyBaseLogger } from 'fastify';
import {
  appUrl,
  callService,
  conflict,
  notFound,
  publishEvent,
  queueEmailSafe,
  type ApplicationStage,
  type ApplicationStatus,
  type Db,
} from '@hireflow/shared';
import { sql } from '../db.js';

export type Row = Record<string, any>;

/** Version columns, qualified with table alias `v`. */
export const versionCols = () => sql`
  v.id, v.version, v.designation, v.base_salary, v.variable_pay, v.joining_bonus, v.equity, v.currency,
  v.joining_date, v.location, v.benefits, v.additional_terms, v.created_at
`;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function toOffer(o: Row, current: Row | undefined) {
  const { tokenHash: _t, ...rest } = o;
  return { ...rest, current: current ?? null };
}

/** Loads offers with their current version attached. */
export async function withCurrent(db: Db, offers: Row[]) {
  if (!offers.length) return [];
  const ids = offers.map((o) => o.id);
  const versions = await db`
    select v.offer_id, ${versionCols()} from offer.offer_versions v
    join offer.offers o on o.id = v.offer_id and o.current_version = v.version
    where v.offer_id = any(${ids}::uuid[])
  `;
  const byOffer = new Map(versions.map(({ offerId, ...v }) => [offerId as string, v]));
  return offers.map((o) => toOffer(o, byOffer.get(o.id)));
}

export async function getOffer(db: Db, id: string) {
  const [o] = await db`select * from offer.offers where id = ${id}`;
  if (!o) throw notFound('Offer');
  return (await withCurrent(db, [o]))[0];
}

export async function currentVersion(db: Db, offer: Row): Promise<Row> {
  const [v] = await db`select ${versionCols()} from offer.offer_versions v where v.offer_id = ${offer.id} and v.version = ${offer.currentVersion}`;
  return v;
}

export async function messagesFor(db: Db, offerId: string) {
  return db`
    select id, actor, author_id, message, requested_base_salary, requested_joining_date, offer_version, created_at
    from offer.negotiation_messages where offer_id = ${offerId} order by created_at
  `;
}

export function eventBase(o: Row) {
  return { aggregateType: 'offer', aggregateId: o.id as string, candidateId: o.candidateId, jobId: o.jobId, applicationId: o.applicationId };
}

export async function updateApplication(
  applicationId: string,
  body: { stage?: ApplicationStage; status?: ApplicationStatus; note?: string; actorId?: string | null },
  log: FastifyBaseLogger,
) {
  try {
    await callService('talent', `/internal/applications/${applicationId}/stage`, { method: 'POST', body: { ...body, actorId: body.actorId ?? undefined } });
  } catch (err) {
    log.error({ err, applicationId, body }, 'Failed to update application stage');
  }
}

/** Emails the recruiter who created the offer about a candidate response. */
export async function notifyRecruiter(offer: Row, response: string, message: string, log: FastifyBaseLogger) {
  if (!offer.createdBy) return;
  try {
    const user = await callService<{ email: string; name: string; isActive: boolean }>('identity', `/internal/users/${offer.createdBy}`);
    if (!user?.email || !user.isActive) return;
    await queueEmailSafe(
      {
        templateKey: 'offer_response_internal',
        to: user.email,
        data: { candidateName: offer.candidateName, jobTitle: offer.jobTitle, response, message, link: appUrl(`/offers/${offer.id}`) },
        relatedType: 'offer',
        relatedId: offer.id,
        candidateId: offer.candidateId,
      },
      log,
    );
  } catch (err) {
    log.error({ err, offerId: offer.id }, 'Failed to notify recruiter');
  }
}

/**
 * Accepts an offer (candidate portal or HR "mark accepted"): status -> accepted, application -> pre_joining,
 * onboarding case created, recruiter notified.
 */
export async function acceptOffer(offerId: string, opts: { joiningDate?: string | null; actorId?: string | null; allowed: string[] }, log: FastifyBaseLogger) {
  const { offer, version } = await sql.begin(async (tx) => {
    const [o] = await tx`select * from offer.offers where id = ${offerId} for update`;
    if (!o) throw notFound('Offer');
    if (!opts.allowed.includes(o.status)) throw conflict(`This offer is ${o.status} and can no longer be accepted`);
    if (opts.joiningDate) {
      await tx`update offer.offer_versions set joining_date = ${opts.joiningDate} where offer_id = ${o.id} and version = ${o.currentVersion}`;
    }
    const [u] = await tx`update offer.offers set status = 'accepted', responded_at = now() where id = ${o.id} returning *`;
    const v = await currentVersion(tx, u);
    await publishEvent(tx, {
      type: 'offer.accepted',
      ...eventBase(u),
      actorId: opts.actorId ?? null,
      payload: { candidateName: u.candidateName, jobTitle: u.jobTitle, designation: v.designation, joiningDate: v.joiningDate, byRecruiter: !!opts.actorId },
    });
    return { offer: u, version: v };
  });

  await updateApplication(offer.applicationId, { stage: 'pre_joining', note: 'Offer accepted', actorId: opts.actorId }, log);

  const caseBody = {
    applicationId: offer.applicationId,
    candidateId: offer.candidateId,
    jobId: offer.jobId,
    offerId: offer.id,
    candidateName: offer.candidateName,
    candidateEmail: offer.candidateEmail,
    jobTitle: version.designation || offer.jobTitle,
    joiningDate: version.joiningDate ?? null,
  };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await callService('onboarding', '/internal/cases', { method: 'POST', body: caseBody });
      break;
    } catch (err) {
      log.error({ err, offerId: offer.id, attempt }, 'Failed to create onboarding case');
    }
  }

  if (!opts.actorId) await notifyRecruiter(offer, 'accepted', `Joining date: ${version.joiningDate ?? 'not set'}`, log);
  return offer;
}
