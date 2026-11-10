import type { FastifyInstance } from 'fastify';
import {
  appUrl,
  callService,
  forbidden,
  getUser,
  HR_ROLES,
  idParams,
  optionalText,
  orNotFound,
  paginationQuery,
  parse,
  publishEvent,
  queueEmailSafe,
  requireRole,
  toLimitOffset,
  z,
} from '@hireflow/shared';
import { sql } from '../db.js';
import { queryApplications, transitionApplication } from '../lib/applications.js';
import { jobTitles } from '../lib/jobs.js';

const reviewColumns = sql`r.id, r.application_id, r.reviewer_id, r.requested_by, r.status, r.decision, r.rating, r.comments, r.due_at, r.requested_at, r.submitted_at`;

export async function reviewRoutes(app: FastifyInstance) {
  app.post('/reviews/request', async (req) => {
    const user = requireRole(req, 'recruiter');
    const body = parse(
      z.object({
        applicationIds: z.array(z.string().uuid()).min(1).max(200),
        reviewerIds: z.array(z.string().uuid()).min(1).max(20),
        dueAt: z.coerce.date().nullish(),
      }),
      req.body,
    );
    const appIds = [...new Set(body.applicationIds)];
    const reviewerIds = [...new Set(body.reviewerIds)];
    const apps = await sql<{ id: string; jobId: string; candidateId: string; fullName: string; stage: string; status: string }[]>`
      select a.id, a.job_id, a.candidate_id, a.stage, a.status, c.full_name
      from talent.applications a join talent.candidates c on c.id = a.candidate_id
      where a.id = any(${appIds}::uuid[])
    `;
    const titles = await jobTitles(apps.map((a) => a.jobId));

    const created = await sql.begin(async (tx) => {
      const rows = await tx<{ id: string; applicationId: string; reviewerId: string }[]>`
        insert into talent.reviews (application_id, reviewer_id, requested_by, due_at)
        select a.id, r.id, ${user.id}, ${body.dueAt ?? null}
        from unnest(${apps.map((a) => a.id)}::uuid[]) as a(id)
        cross join unnest(${reviewerIds}::uuid[]) as r(id)
        on conflict (application_id, reviewer_id) do update
          set status = 'pending', requested_by = excluded.requested_by, due_at = excluded.due_at, requested_at = now(),
              decision = null, rating = null, comments = null, submitted_at = null
          where talent.reviews.status = 'cancelled'
        returning id, application_id, reviewer_id
      `;
      for (const a of apps) {
        const count = rows.filter((r) => r.applicationId === a.id).length;
        if (!count) continue;
        if (a.stage === 'applied' && a.status === 'active') {
          await transitionApplication(tx, a.id, { stage: 'screening', note: 'Sent for resume review', actorId: user.id, jobTitle: titles.get(a.jobId) ?? null });
        }
        await publishEvent(tx, {
          type: 'review.requested',
          aggregateType: 'application',
          aggregateId: a.id,
          candidateId: a.candidateId,
          jobId: a.jobId,
          applicationId: a.id,
          actorId: user.id,
          payload: { candidateName: a.fullName, jobTitle: titles.get(a.jobId) ?? null, reviewerIds: rows.filter((r) => r.applicationId === a.id).map((r) => r.reviewerId) },
        });
      }
      return rows;
    });

    // one email per reviewer
    if (created.length) {
      const reviewers = await callService<{ id: string; email: string; name: string; isActive: boolean }[]>('identity', '/internal/users', {
        query: { ids: reviewerIds.join(',') },
      }).catch((err) => {
        req.log.error({ err }, 'Could not load reviewers for email');
        return [];
      });
      const jobOf = new Map(apps.map((a) => [a.id, a.jobId]));
      for (const reviewer of reviewers) {
        const mine = created.filter((r) => r.reviewerId === reviewer.id);
        if (!mine.length || !reviewer.isActive) continue;
        const jobNames = [...new Set(mine.map((r) => titles.get(jobOf.get(r.applicationId) ?? '') ?? '').filter(Boolean))];
        await queueEmailSafe(
          {
            templateKey: 'review_requested',
            to: reviewer.email,
            data: { reviewerName: reviewer.name || reviewer.email, count: mine.length, jobTitle: jobNames.join(', ') || 'open roles', link: appUrl('/reviews') },
            relatedType: 'review',
            createdBy: user.id,
          },
          req.log,
        );
      }
    }
    return { created: created.length };
  });

  app.get('/reviews', async (req) => {
    const user = getUser(req);
    const q = parse(
      paginationQuery.extend({
        mine: z.enum(['true', 'false']).optional(),
        status: z.enum(['pending', 'completed', 'cancelled']).optional(),
        applicationId: z.string().uuid().optional(),
        jobId: z.string().uuid().optional(),
      }),
      req.query,
    );
    // reviewers & interviewers only ever see their own reviews
    const onlyMine = q.mine === 'true' || user.role === 'reviewer' || user.role === 'interviewer';
    const where = sql`
      ${onlyMine ? sql`and r.reviewer_id = ${user.id}` : sql``}
      ${q.status ? sql`and r.status = ${q.status}` : sql`and r.status <> 'cancelled'`}
      ${q.applicationId ? sql`and r.application_id = ${q.applicationId}` : sql``}
      ${q.jobId ? sql`and a.job_id = ${q.jobId}` : sql``}
    `;
    const { limit, offset } = toLimitOffset(q);
    const [reviews, [count]] = await Promise.all([
      sql<{ id: string; applicationId: string }[]>`
        select ${reviewColumns}
        from talent.reviews r join talent.applications a on a.id = r.application_id
        where true ${where}
        order by (r.status = 'pending') desc, coalesce(r.due_at, r.requested_at) asc
        limit ${limit} offset ${offset}
      `,
      sql<{ total: number }[]>`
        select count(*)::int as total from talent.reviews r join talent.applications a on a.id = r.application_id where true ${where}
      `,
    ]);
    const appIds = [...new Set(reviews.map((r) => r.applicationId))];
    const apps = appIds.length ? await queryApplications(sql`and a.id = any(${appIds}::uuid[])`) : [];
    const byId = new Map(apps.map((a) => [a.id, a]));
    return { data: reviews.map((r) => ({ ...r, application: byId.get(r.applicationId) ?? null })), total: count!.total };
  });

  app.post('/reviews/:id/submit', async (req) => {
    const user = getUser(req);
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({
        decision: z.enum(['strong_yes', 'yes', 'maybe', 'no']),
        rating: z.coerce.number().int().min(1).max(5),
        comments: optionalText(10_000),
      }),
      req.body,
    );
    const [review] = await sql<{ reviewerId: string; status: string }[]>`select reviewer_id, status from talent.reviews where id = ${id}`;
    orNotFound(review, 'Review');
    if (review!.reviewerId !== user.id && !HR_ROLES.includes(user.role)) throw forbidden('This review is assigned to someone else');
    if (review!.status === 'cancelled') throw forbidden('This review request was cancelled');

    const updated = await sql.begin(async (tx) => {
      const [r] = await tx`
        update talent.reviews r
        set status = 'completed', decision = ${body.decision}, rating = ${body.rating}, comments = ${body.comments ?? null}, submitted_at = now()
        where r.id = ${id}
        returning ${reviewColumns}
      `;
      const [ctx] = await tx<{ candidateId: string; jobId: string; fullName: string }[]>`
        select a.candidate_id, a.job_id, c.full_name from talent.applications a join talent.candidates c on c.id = a.candidate_id
        where a.id = ${r!.applicationId as string}
      `;
      const titles = await jobTitles([ctx!.jobId]);
      await publishEvent(tx, {
        type: 'review.submitted',
        aggregateType: 'review',
        aggregateId: id,
        candidateId: ctx!.candidateId,
        jobId: ctx!.jobId,
        applicationId: r!.applicationId as string,
        actorId: user.id,
        payload: { candidateName: ctx!.fullName, jobTitle: titles.get(ctx!.jobId) ?? null, decision: body.decision, rating: body.rating },
      });
      return r;
    });
    return updated;
  });

  app.delete('/reviews/:id', async (req, reply) => {
    requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const [r] = await sql`update talent.reviews set status = 'cancelled' where id = ${id} and status = 'pending' returning id`;
    if (!r) {
      const [exists] = await sql`select 1 from talent.reviews where id = ${id}`;
      orNotFound(exists, 'Review');
    }
    return reply.status(204).send();
  });
}
