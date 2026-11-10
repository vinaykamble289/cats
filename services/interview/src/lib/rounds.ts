import type { FastifyBaseLogger } from 'fastify';
import {
  addDays,
  AppError,
  badRequest,
  callService,
  conflict,
  createToken,
  formatDateTime,
  notFound,
  portalUrl,
  publishEvent,
  queueEmailSafe,
  type ApplicationStage,
  type Db,
} from '@hireflow/shared';
import { sql } from '../db.js';
import { integrityFromCounts, proctorSummary } from './proctor.js';

export type Row = Record<string, any>;

export const AI_KINDS = ['ai_screening', 'ai_proctored'];
export const RECOMMENDATIONS = ['strong_hire', 'hire', 'lean_hire', 'lean_no_hire', 'no_hire'] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export interface UserRef {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
}

/** Round row + aggregated interviewer ids. */
export const roundSelect = () => sql`
  select r.*,
    coalesce((select array_agg(ri.user_id::text order by ri.user_id) from interview.round_interviewers ri where ri.round_id = r.id), '{}'::text[]) as interviewer_ids
  from interview.rounds r
`;

/** Strips secrets / internal fields before returning a round to clients. */
export function toRound(r: Row) {
  const { tokenHash: _t, jobContext: _j, ...rest } = r;
  return { ...rest, interviewerIds: r.interviewerIds ?? [] };
}

export async function getRound(id: string): Promise<Row | undefined> {
  const [r] = await sql`${roundSelect()} where r.id = ${id}`;
  return r;
}

export async function loadMessages(db: Db, roundId: string) {
  return db<{ seq: number; role: 'interviewer' | 'candidate'; content: string; createdAt: Date }[]>`
    select seq, role, content, created_at from interview.messages where round_id = ${roundId} order by seq
  `;
}

export function eventBase(r: Row) {
  return { aggregateType: 'interview_round', aggregateId: r.id as string, candidateId: r.candidateId, jobId: r.jobId, applicationId: r.applicationId };
}

export function recommendationFromScore(score: number): Recommendation {
  if (score >= 85) return 'strong_hire';
  if (score >= 70) return 'hire';
  if (score >= 55) return 'lean_hire';
  if (score >= 40) return 'lean_no_hire';
  return 'no_hire';
}

export async function moveStage(applicationId: string, stage: ApplicationStage, actorId: string | null | undefined, note: string, log: FastifyBaseLogger) {
  try {
    await callService('talent', `/internal/applications/${applicationId}/stage`, { method: 'POST', body: { stage, note, actorId: actorId ?? undefined } });
  } catch (err) {
    log.error({ err, applicationId, stage }, 'Failed to update application stage');
  }
}

export async function getUsers(ids: string[]): Promise<UserRef[]> {
  if (!ids.length) return [];
  return callService<UserRef[]>('identity', '/internal/users', { query: { ids: ids.join(',') } });
}

/** Issues a fresh candidate link for an AI round and emails it. */
export async function inviteRound(roundId: string, actorId: string | null | undefined, log: FastifyBaseLogger): Promise<Row> {
  const { token, hash } = createToken();
  const expiresAt = addDays(5);
  const round = await sql.begin(async (tx) => {
    const [r] = await tx`select * from interview.rounds where id = ${roundId} for update`;
    if (!r) throw notFound('Interview round');
    if (!AI_KINDS.includes(r.kind)) throw badRequest('Live interview rounds are scheduled, not invited');
    if (!['pending', 'invited', 'expired'].includes(r.status)) throw conflict(`This round is already ${r.status.replace('_', ' ')}`);
    const [u] = await tx`
      update interview.rounds set status = 'invited', token_hash = ${hash}, expires_at = ${expiresAt}
      where id = ${roundId} returning *
    `;
    await publishEvent(tx, {
      type: 'interview.invited',
      ...eventBase(r),
      actorId,
      payload: { candidateName: r.candidateName, jobTitle: r.jobTitle, roundName: r.name, kind: r.kind },
    });
    return u;
  });

  await queueEmailSafe(
    {
      templateKey: 'ai_interview_invite',
      to: round.candidateEmail,
      data: {
        candidateName: round.candidateName,
        jobTitle: round.jobTitle,
        roundName: round.name,
        durationMin: round.durationMin,
        link: portalUrl('interview', token),
        expiresAt: formatDateTime(expiresAt),
        proctoringNote:
          round.kind === 'ai_proctored'
            ? 'This round is proctored: please use a laptop with a webcam, stay in full-screen mode and do not switch tabs or paste answers.'
            : 'Please find a quiet place with a stable internet connection before you begin.',
      },
      relatedType: 'interview_round',
      relatedId: round.id,
      candidateId: round.candidateId,
      createdBy: actorId ?? undefined,
    },
    log,
  );
  return round;
}

/**
 * Called after a round reaches `evaluated`. Idempotent: only acts when the immediately
 * following (non-cancelled) round is still `pending`.
 */
export async function advanceAfterRound(round: Row, actorId: string | null | undefined, log: FastifyBaseLogger): Promise<void> {
  const payload = { candidateName: round.candidateName, jobTitle: round.jobTitle, roundName: round.name, score: round.score };
  if (!round.passed) {
    await publishEvent(sql, { type: 'interview.round_failed', ...eventBase(round), actorId, payload });
    return;
  }
  const [next] = await sql`
    select * from interview.rounds
    where application_id = ${round.applicationId} and sequence > ${round.sequence} and status <> 'cancelled'
    order by sequence limit 1
  `;
  if (!next) {
    const [agg] = await sql`
      select count(*)::int as total, count(*) filter (where passed)::int as passed
      from interview.rounds where application_id = ${round.applicationId} and status <> 'cancelled'
    `;
    if (agg.total > 0 && agg.total === agg.passed) {
      await publishEvent(sql, { type: 'interview.series_passed', ...eventBase(round), actorId, payload: { candidateName: round.candidateName, jobTitle: round.jobTitle } });
    }
    return;
  }
  if (next.status !== 'pending') return;
  if (AI_KINDS.includes(next.kind)) {
    try {
      await inviteRound(next.id, actorId, log);
    } catch (err) {
      log.error({ err, roundId: next.id }, 'Failed to auto-invite next AI round');
    }
  } else {
    await moveStage(round.applicationId, 'interview', actorId, `Passed ${round.name}; next: ${next.name}`, log);
  }
}

/** Marks an in-progress round completed (inside a tx). Returns the row or null if it wasn't in progress. */
export async function completeRound(tx: Db, round: Row): Promise<Row | null> {
  const [u] = await tx`
    update interview.rounds set status = 'completed', completed_at = now()
    where id = ${round.id} and status = 'in_progress' returning *
  `;
  if (!u) return null;
  await publishEvent(tx, {
    type: 'interview.completed',
    ...eventBase(round),
    payload: { candidateName: round.candidateName, jobTitle: round.jobTitle, roundName: round.name },
  });
  return u;
}

interface AiEvaluation {
  overallScore: number;
  recommendation: string;
  summary: string;
  strengths: string[];
  concerns: string[];
  competencies: { name: string; score: number; comment: string }[];
}

const evaluating = new Set<string>();

/** Runs the AI evaluation of a completed AI round, then advances the series. Never throws. */
export async function evaluateAiRound(roundId: string, log: FastifyBaseLogger): Promise<void> {
  if (evaluating.has(roundId)) return;
  evaluating.add(roundId);
  try {
    const [r] = await sql`select * from interview.rounds where id = ${roundId}`;
    if (!r || r.status !== 'completed' || !AI_KINDS.includes(r.kind)) return;
    const messages = await loadMessages(sql, roundId);
    const answered = messages.some((m) => m.role === 'candidate');

    let evaluation: AiEvaluation;
    if (!answered) {
      evaluation = {
        overallScore: 0,
        recommendation: 'no_hire',
        summary: 'The candidate did not answer any questions.',
        strengths: [],
        concerns: ['No answers were submitted.'],
        competencies: [],
      };
    } else {
      evaluation = await callService<AiEvaluation>('ai', '/internal/interview/evaluate', {
        method: 'POST',
        timeoutMs: 90_000,
        body: {
          jobTitle: r.jobTitle,
          jobContext: r.jobContext ?? '',
          roundName: r.name,
          focusAreas: r.focusAreas ?? '',
          transcript: messages.map((m) => ({ role: m.role, content: m.content })),
        },
      });
    }

    const score = Math.max(0, Math.min(100, Math.round(Number(evaluation.overallScore) || 0)));
    const recommendation = (RECOMMENDATIONS as readonly string[]).includes(evaluation.recommendation)
      ? (evaluation.recommendation as Recommendation)
      : recommendationFromScore(score);
    const integrity = r.kind === 'ai_proctored' ? integrityFromCounts((await proctorSummary(sql, roundId)).counts) : null;
    const passed = score >= r.passScore;
    const stored = {
      overallScore: score,
      recommendation,
      summary: evaluation.summary ?? '',
      strengths: Array.isArray(evaluation.strengths) ? evaluation.strengths : [],
      concerns: Array.isArray(evaluation.concerns) ? evaluation.concerns : [],
      competencies: Array.isArray(evaluation.competencies) ? evaluation.competencies : [],
    };

    const updated = await sql.begin(async (tx) => {
      const [u] = await tx`
        update interview.rounds
        set status = 'evaluated', score = ${score}, passed = ${passed}, recommendation = ${recommendation},
            ai_summary = ${stored.summary}, evaluation = ${tx.json(stored as never)}, integrity_score = ${integrity}
        where id = ${roundId} and status = 'completed' returning *
      `;
      if (!u) return null;
      await publishEvent(tx, {
        type: 'interview.evaluated',
        ...eventBase(u),
        payload: { candidateName: u.candidateName, jobTitle: u.jobTitle, roundName: u.name, score, passed, recommendation, integrityScore: integrity },
      });
      return u;
    });
    if (updated) await advanceAfterRound(updated, null, log);
  } catch (err) {
    log.error({ err, roundId }, 'AI interview evaluation failed (will retry)');
  } finally {
    evaluating.delete(roundId);
  }
}

/**
 * Generates the next interviewer turn when the transcript is empty or ends with a candidate message.
 * Safe against concurrent calls (re-checks the last message under a row lock before inserting).
 */
export async function generateNextTurn(roundId: string, log: FastifyBaseLogger): Promise<{ done: boolean }> {
  const [r] = await sql`select * from interview.rounds where id = ${roundId}`;
  if (!r || r.status !== 'in_progress') return { done: r?.status !== 'in_progress' };
  const messages = await loadMessages(sql, roundId);
  const last = messages[messages.length - 1];
  if (last && last.role === 'interviewer') return { done: false };

  let next: { message: string; done: boolean };
  try {
    next = await callService<{ message: string; done: boolean }>('ai', '/internal/interview/next', {
      method: 'POST',
      timeoutMs: 60_000,
      body: {
        candidateName: r.candidateName,
        jobTitle: r.jobTitle,
        jobContext: r.jobContext ?? '',
        roundName: r.name,
        kind: r.kind,
        focusAreas: r.focusAreas ?? '',
        questionCount: r.questionCount,
        transcript: messages.map((m) => ({ role: m.role, content: m.content })),
      },
    });
  } catch (err) {
    log.error({ err, roundId }, 'AI interviewer failed to respond');
    throw new AppError(503, 'The AI interviewer is taking a moment. Your answer is saved — please press retry.', 'AI_UNAVAILABLE');
  }
  const text = String(next.message ?? '').trim() || 'Thank you. Could you elaborate a little more on that?';
  const answers = messages.filter((m) => m.role === 'candidate').length;

  const completed = await sql.begin(async (tx) => {
    const [locked] = await tx`select * from interview.rounds where id = ${roundId} for update`;
    if (!locked || locked.status !== 'in_progress') return false;
    const [lastNow] = await tx`select seq, role from interview.messages where round_id = ${roundId} order by seq desc limit 1`;
    if (lastNow && lastNow.role === 'interviewer') return false;
    await tx`
      insert into interview.messages (round_id, seq, role, content)
      values (${roundId}, ${(lastNow?.seq ?? 0) + 1}, 'interviewer', ${text})
    `;
    if (next.done && answers > 0) return !!(await completeRound(tx, locked));
    return false;
  });
  if (completed) void evaluateAiRound(roundId, log);
  return { done: completed };
}

/** Periodic maintenance: expire links, close abandoned interviews, retry failed evaluations. */
export async function runMaintenance(log: FastifyBaseLogger): Promise<void> {
  await sql`update interview.rounds set status = 'expired' where status = 'invited' and expires_at < now()`;
  const stale = await sql.begin(async (tx) => {
    const rows = await tx`
      select * from interview.rounds
      where status = 'in_progress' and started_at + (duration_min * 2) * interval '1 minute' < now()
      for update skip locked
    `;
    const done: Row[] = [];
    for (const r of rows) {
      const c = await completeRound(tx, r);
      if (c) done.push(c);
    }
    return done;
  });
  const pending = await sql`
    select id from interview.rounds
    where status = 'completed' and kind <> 'human' and completed_at < now() - interval '3 minutes'
    order by completed_at limit 10
  `;
  const ids = new Set([...stale.map((r) => r.id as string), ...pending.map((r) => r.id as string)]);
  for (const id of ids) await evaluateAiRound(id, log);
}
