import type { FastifyInstance } from 'fastify';
import {
  badRequest,
  callService,
  conflict,
  csvList,
  forbidden,
  formatDateTime,
  getUser,
  HR_ROLES,
  idParams,
  notFound,
  optionalText,
  paginationQuery,
  parse,
  publishEvent,
  queueEmailSafe,
  requireRole,
  toLimitOffset,
  uuid,
  z,
  appUrl,
  type ApplicationContext,
  type JobContext,
} from '@hireflow/shared';
import { sql } from '../db.js';
import { buildIcs } from '../lib/ics.js';
import { proctorSummary } from '../lib/proctor.js';
import {
  advanceAfterRound,
  AI_KINDS,
  eventBase,
  getRound,
  getUsers,
  inviteRound,
  loadMessages,
  moveStage,
  RECOMMENDATIONS,
  roundSelect,
  toRound,
  type Row,
} from '../lib/rounds.js';

const KINDS = ['ai_screening', 'ai_proctored', 'human'] as const;

const listQuery = paginationQuery.extend({
  applicationId: uuid.optional(),
  candidateId: uuid.optional(),
  status: csvList,
  kind: csvList,
  mine: z.enum(['true', 'false']).optional(),
  upcoming: z.enum(['true', 'false']).optional(),
});

const adHocBody = z.object({
  applicationId: uuid,
  name: z.string().trim().min(1).max(120),
  kind: z.enum(KINDS),
  durationMin: z.number().int().min(5).max(240).default(30),
  questionCount: z.number().int().min(1).max(30).default(6),
  passScore: z.number().int().min(0).max(100).default(60),
  focusAreas: optionalText(2000),
});

const scheduleBody = z.object({
  scheduledAt: z.string().datetime({ offset: true }),
  durationMin: z.number().int().min(5).max(240).optional(),
  meetingUrl: z.string().trim().url().max(1000),
  interviewerIds: z.array(uuid).min(1).max(10),
});

const feedbackBody = z.object({
  rating: z.number().int().min(1).max(5),
  recommendation: z.enum(RECOMMENDATIONS),
  strengths: optionalText(5000),
  concerns: optionalText(5000),
  comments: optionalText(5000),
});

const decisionBody = z.object({ passed: z.boolean(), note: optionalText(2000) });

function jobContextText(job: JobContext): string {
  const desc = (job.description ?? '').trim().slice(0, 4000);
  const skills = job.skills.map((s) => `${s.name}${s.isRequired ? '' : ' (nice to have)'}`).join(', ');
  return `${desc}${skills ? `\n\nKey skills: ${skills}` : ''}`;
}

function isHR(role: string) {
  return (HR_ROLES as string[]).includes(role);
}

/** Majority recommendation; ties resolve to the more conservative option. */
function majority(recs: string[]): (typeof RECOMMENDATIONS)[number] {
  const counts = new Map<string, number>();
  for (const r of recs) counts.set(r, (counts.get(r) ?? 0) + 1);
  let best: (typeof RECOMMENDATIONS)[number] = 'no_hire';
  let bestCount = -1;
  RECOMMENDATIONS.forEach((r) => {
    const c = counts.get(r) ?? 0;
    if (c > 0 && c >= bestCount) {
      best = r;
      bestCount = c;
    }
  });
  return best;
}

export async function roundRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------- list & stats
  app.get('/rounds', async (req) => {
    const user = getUser(req);
    const q = parse(listQuery, req.query);
    const { limit, offset } = toLimitOffset(q);
    const conds = [sql`true`];
    if (q.applicationId) conds.push(sql`r.application_id = ${q.applicationId}`);
    if (q.candidateId) conds.push(sql`r.candidate_id = ${q.candidateId}`);
    if (q.status?.length) conds.push(sql`r.status::text = any(${q.status})`);
    if (q.kind?.length) conds.push(sql`r.kind::text = any(${q.kind})`);
    if (q.mine === 'true' || user.role === 'interviewer') {
      conds.push(sql`exists (select 1 from interview.round_interviewers ri where ri.round_id = r.id and ri.user_id = ${user.id})`);
    }
    const upcoming = q.upcoming === 'true';
    if (upcoming) conds.push(sql`r.status = 'scheduled' and r.scheduled_at >= now()`);
    const where = conds.reduce((a, b) => sql`${a} and ${b}`);
    const order = upcoming ? sql`r.scheduled_at asc` : sql`r.created_at desc, r.sequence asc`;
    const [rows, [{ total }]] = await Promise.all([
      sql`${roundSelect()} where ${where} order by ${order} limit ${limit} offset ${offset}`,
      sql`select count(*)::int as total from interview.rounds r where ${where}`,
    ]);
    return { data: rows.map(toRound), total };
  });

  app.get('/rounds/stats', async () => {
    const [byStatus, [agg]] = await Promise.all([
      sql`select status::text as status, count(*)::int as count from interview.rounds group by status`,
      sql`
        select
          count(*) filter (where status = 'scheduled' and scheduled_at >= now())::int as upcoming,
          count(*) filter (where kind = 'human' and status in ('scheduled', 'completed') and scheduled_at < now())::int as awaiting_feedback,
          count(*) filter (where status = 'evaluated' and completed_at >= date_trunc('week', now()))::int as completed_this_week
        from interview.rounds
      `,
    ]);
    return {
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.count])),
      upcoming: agg.upcoming,
      awaitingFeedback: agg.awaitingFeedback,
      completedThisWeek: agg.completedThisWeek,
    };
  });

  // ---------------------------------------------------------------- series
  app.post('/rounds/series', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { applicationIds } = parse(z.object({ applicationIds: z.array(uuid).min(1).max(200) }), req.body);
    const jobs = new Map<string, JobContext>();
    let created = 0;
    let skipped = 0;
    const errors: { applicationId: string; error: string }[] = [];

    for (const applicationId of [...new Set(applicationIds)]) {
      try {
        const appCtx = await callService<ApplicationContext>('talent', `/internal/applications/${applicationId}`);
        if (appCtx.status !== 'active') throw badRequest(`${appCtx.candidateName}: application is ${appCtx.status}`);
        const [{ existing }] = await sql`
          select count(*)::int as existing from interview.rounds where application_id = ${applicationId} and status <> 'cancelled'
        `;
        if (existing > 0) {
          skipped++;
          continue;
        }
        let job = jobs.get(appCtx.jobId);
        if (!job) {
          job = await callService<JobContext>('jobs', `/internal/jobs/${appCtx.jobId}`);
          jobs.set(appCtx.jobId, job);
        }
        if (!job.interviewPlan.length) throw badRequest(`${job.title} has no interview plan`);
        const context = jobContextText(job);
        const plan = [...job.interviewPlan].sort((a, b) => a.sequence - b.sequence);

        const rounds = await sql.begin(async (tx) => {
          const inserted: Row[] = [];
          for (const [i, p] of plan.entries()) {
            const [r] = await tx`
              insert into interview.rounds ${tx({
                applicationId,
                candidateId: appCtx.candidateId,
                jobId: job!.id,
                candidateName: appCtx.candidateName,
                candidateEmail: appCtx.candidateEmail,
                jobTitle: job!.title,
                jobContext: context,
                sequence: i + 1,
                name: p.name,
                kind: p.kind,
                durationMin: p.durationMin,
                questionCount: p.questionCount,
                passScore: p.passScore,
                focusAreas: p.focusAreas,
                createdBy: user.id,
              })}
              returning *
            `;
            inserted.push(r);
          }
          await publishEvent(tx, {
            type: 'interview.series_created',
            aggregateType: 'application',
            aggregateId: applicationId,
            candidateId: appCtx.candidateId,
            jobId: job!.id,
            applicationId,
            actorId: user.id,
            payload: { candidateName: appCtx.candidateName, jobTitle: job!.title, rounds: plan.map((p) => p.name) },
          });
          return inserted;
        });

        const first = rounds[0];
        if (AI_KINDS.includes(first.kind)) {
          await inviteRound(first.id, user.id, req.log);
          await moveStage(applicationId, 'ai_interview', user.id, `Interview series started: ${first.name}`, req.log);
        } else {
          await moveStage(applicationId, 'interview', user.id, `Interview series started: ${first.name}`, req.log);
        }
        created++;
      } catch (err) {
        errors.push({ applicationId, error: (err as Error).message });
      }
    }
    return { created, skipped, errors };
  });

  app.post('/rounds', async (req) => {
    const user = requireRole(req, 'recruiter');
    const body = parse(adHocBody, req.body);
    const appCtx = await callService<ApplicationContext>('talent', `/internal/applications/${body.applicationId}`);
    const job = await callService<JobContext>('jobs', `/internal/jobs/${appCtx.jobId}`);
    const round = await sql.begin(async (tx) => {
      const [{ next }] = await tx`
        select coalesce(max(sequence), 0)::int + 1 as next from interview.rounds
        where application_id = ${body.applicationId} and status <> 'cancelled'
      `;
      const [r] = await tx`
        insert into interview.rounds ${tx({
          applicationId: body.applicationId,
          candidateId: appCtx.candidateId,
          jobId: job.id,
          candidateName: appCtx.candidateName,
          candidateEmail: appCtx.candidateEmail,
          jobTitle: job.title,
          jobContext: jobContextText(job),
          sequence: next,
          name: body.name,
          kind: body.kind,
          durationMin: body.durationMin,
          questionCount: body.questionCount,
          passScore: body.passScore,
          focusAreas: body.focusAreas ?? null,
          createdBy: user.id,
        })}
        returning id
      `;
      await publishEvent(tx, {
        type: 'interview.round_added',
        aggregateType: 'interview_round',
        aggregateId: r.id,
        candidateId: appCtx.candidateId,
        jobId: job.id,
        applicationId: body.applicationId,
        actorId: user.id,
        payload: { candidateName: appCtx.candidateName, jobTitle: job.title, roundName: body.name, kind: body.kind },
      });
      return r;
    });
    return toRound((await getRound(round.id))!);
  });

  // ---------------------------------------------------------------- detail
  app.get('/rounds/:id', async (req) => {
    const user = getUser(req);
    const { id } = parse(idParams, req.params);
    const round = await getRound(id);
    if (!round) throw notFoundRound();
    if (user.role === 'interviewer' && !round.interviewerIds.includes(user.id)) throw forbidden('You are not on the panel for this interview');
    const [messages, feedback, proctoring] = await Promise.all([
      loadMessages(sql, id),
      sql`
        select id, interviewer_id, rating, recommendation, strengths, concerns, comments, submitted_at
        from interview.feedback where round_id = ${id} order by submitted_at
      `,
      proctorSummary(sql, id),
    ]);
    return { ...toRound(round), messages, feedback, proctoring };
  });

  // ---------------------------------------------------------------- actions
  app.post('/rounds/:id/invite', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    await inviteRound(id, user.id, req.log);
    return toRound((await getRound(id))!);
  });

  app.post('/rounds/:id/schedule', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const body = parse(scheduleBody, req.body);
    const scheduledAt = new Date(body.scheduledAt);
    const interviewerIds = [...new Set(body.interviewerIds)];

    const { round, rescheduled } = await sql.begin(async (tx) => {
      const [r] = await tx`select * from interview.rounds where id = ${id} for update`;
      if (!r) throw notFoundRound();
      if (r.kind !== 'human') throw badRequest('Only live interview rounds can be scheduled');
      if (!['pending', 'scheduled', 'no_show'].includes(r.status)) throw conflict(`This round is already ${r.status.replace('_', ' ')}`);
      const [u] = await tx`
        update interview.rounds
        set status = 'scheduled', scheduled_at = ${scheduledAt}, meeting_url = ${body.meetingUrl},
            duration_min = ${body.durationMin ?? r.durationMin}
        where id = ${id} returning *
      `;
      await tx`delete from interview.round_interviewers where round_id = ${id}`;
      await tx`insert into interview.round_interviewers ${tx(interviewerIds.map((userId) => ({ roundId: id, userId })))}`;
      await publishEvent(tx, {
        type: 'interview.scheduled',
        ...eventBase(r),
        actorId: user.id,
        payload: { candidateName: r.candidateName, jobTitle: r.jobTitle, roundName: r.name, scheduledAt: scheduledAt.toISOString(), rescheduled: r.status === 'scheduled' },
      });
      return { round: u, rescheduled: r.status === 'scheduled' };
    });

    await moveStage(round.applicationId, 'interview', user.id, `${round.name} scheduled`, req.log);

    const when = formatDateTime(scheduledAt);
    const ics = buildIcs({
      uid: round.id,
      start: scheduledAt,
      durationMin: round.durationMin,
      summary: `Interview: ${round.candidateName} - ${round.name} (${round.jobTitle})`,
      description: `${round.name} for the ${round.jobTitle} role.\nJoin: ${round.meetingUrl}`,
      location: round.meetingUrl,
      sequence: rescheduled ? Math.floor(Date.now() / 1000) % 100000 : 0,
    });
    const attachments = [{ filename: 'interview.ics', content: ics, contentType: 'text/calendar; charset=utf-8; method=REQUEST' }];

    await queueEmailSafe(
      {
        templateKey: 'interview_scheduled',
        to: round.candidateEmail,
        data: { candidateName: round.candidateName, jobTitle: round.jobTitle, roundName: round.name, scheduledAt: when, meetingUrl: round.meetingUrl, durationMin: round.durationMin },
        relatedType: 'interview_round',
        relatedId: round.id,
        candidateId: round.candidateId,
        attachments,
        createdBy: user.id,
      },
      req.log,
    );

    try {
      const panel = await getUsers(interviewerIds);
      for (const p of panel) {
        await queueEmailSafe(
          {
            templateKey: 'interviewer_assigned',
            to: p.email,
            data: {
              interviewerName: p.name || p.email,
              candidateName: round.candidateName,
              jobTitle: round.jobTitle,
              roundName: round.name,
              scheduledAt: when,
              meetingUrl: round.meetingUrl,
              link: appUrl(`/interviews/${round.id}`),
            },
            relatedType: 'interview_round',
            relatedId: round.id,
            attachments,
            createdBy: user.id,
          },
          req.log,
        );
      }
    } catch (err) {
      req.log.error({ err }, 'Failed to notify interviewers');
    }
    return toRound((await getRound(id))!);
  });

  app.post('/rounds/:id/feedback', async (req) => {
    const user = getUser(req);
    const { id } = parse(idParams, req.params);
    const body = parse(feedbackBody, req.body);

    const result = await sql.begin(async (tx) => {
      const [r] = await tx`${roundSelect()} where r.id = ${id} for update of r`;
      if (!r) throw notFoundRound();
      const assigned: string[] = r.interviewerIds ?? [];
      if (!assigned.includes(user.id) && !isHR(user.role)) throw forbidden('Only panel members can submit feedback for this interview');
      if (r.kind !== 'human') throw badRequest('AI rounds are evaluated automatically');
      if (!['scheduled', 'completed', 'evaluated', 'in_progress'].includes(r.status)) throw conflict(`Feedback cannot be submitted while the round is ${r.status}`);

      await tx`
        insert into interview.feedback ${tx({
          roundId: id,
          interviewerId: user.id,
          rating: body.rating,
          recommendation: body.recommendation,
          strengths: body.strengths ?? null,
          concerns: body.concerns ?? null,
          comments: body.comments ?? null,
        })}
        on conflict (round_id, interviewer_id) do update set
          rating = excluded.rating, recommendation = excluded.recommendation, strengths = excluded.strengths,
          concerns = excluded.concerns, comments = excluded.comments, submitted_at = now()
      `;
      await publishEvent(tx, {
        type: 'interview.feedback_submitted',
        ...eventBase(r),
        actorId: user.id,
        payload: { candidateName: r.candidateName, jobTitle: r.jobTitle, roundName: r.name, rating: body.rating, recommendation: body.recommendation },
      });

      const fb = await tx`select interviewer_id, rating, recommendation from interview.feedback where round_id = ${id}`;
      const complete = assigned.length ? assigned.every((uid) => fb.some((f) => f.interviewerId === uid)) : fb.length > 0;
      if (!complete) return { round: null as Row | null, transitioned: false };

      const avg = fb.reduce((s, f) => s + Number(f.rating), 0) / fb.length;
      const score = Math.round(avg * 20);
      const passed = score >= r.passScore;
      const recommendation = majority(fb.map((f) => f.recommendation));
      const wasEvaluated = r.status === 'evaluated';
      const [u] = await tx`
        update interview.rounds
        set status = 'evaluated', score = ${score}, passed = ${passed}, recommendation = ${recommendation},
            completed_at = coalesce(completed_at, now())
        where id = ${id} returning *
      `;
      if (!wasEvaluated) {
        await publishEvent(tx, {
          type: 'interview.evaluated',
          ...eventBase(r),
          actorId: user.id,
          payload: { candidateName: r.candidateName, jobTitle: r.jobTitle, roundName: r.name, score, passed, recommendation },
        });
      }
      return { round: u, transitioned: !wasEvaluated };
    });

    if (result.round && result.transitioned) await advanceAfterRound(result.round, user.id, req.log);
    return toRound((await getRound(id))!);
  });

  app.post('/rounds/:id/decision', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const body = parse(decisionBody, req.body);
    const round = await sql.begin(async (tx) => {
      const [r] = await tx`select * from interview.rounds where id = ${id} for update`;
      if (!r) throw notFoundRound();
      if (r.status === 'cancelled') throw conflict('This round was cancelled');
      const [u] = await tx`
        update interview.rounds
        set status = 'evaluated', passed = ${body.passed}, completed_at = coalesce(completed_at, now())
        where id = ${id} returning *
      `;
      await publishEvent(tx, {
        type: 'interview.evaluated',
        ...eventBase(r),
        actorId: user.id,
        payload: { candidateName: r.candidateName, jobTitle: r.jobTitle, roundName: r.name, score: r.score, passed: body.passed, manual: true, note: body.note ?? null },
      });
      return u;
    });
    await advanceAfterRound(round, user.id, req.log);
    return toRound((await getRound(id))!);
  });

  app.post('/rounds/:id/cancel', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    await sql.begin(async (tx) => {
      const [r] = await tx`select * from interview.rounds where id = ${id} for update`;
      if (!r) throw notFoundRound();
      if (['cancelled', 'evaluated'].includes(r.status)) throw conflict(`This round is already ${r.status}`);
      await tx`update interview.rounds set status = 'cancelled', token_hash = null where id = ${id}`;
      await publishEvent(tx, {
        type: 'interview.cancelled',
        ...eventBase(r),
        actorId: user.id,
        payload: { candidateName: r.candidateName, jobTitle: r.jobTitle, roundName: r.name },
      });
    });
    return toRound((await getRound(id))!);
  });
}

function notFoundRound() {
  return notFound('Interview round');
}
