import type { FastifyInstance } from 'fastify';
import { conflict, env, gone, hashToken, notFound, parse, publishEvent, z } from '@hireflow/shared';
import { sql } from '../db.js';
import { PROCTOR_EVENT_TYPES } from '../lib/proctor.js';
import { completeRound, eventBase, evaluateAiRound, generateNextTurn, loadMessages, type Row } from '../lib/rounds.js';

const tokenParams = z.object({ token: z.string().min(20).max(200) });
const GRACE_MS = 2 * 60_000;

async function findByToken(token: string): Promise<Row> {
  const [r] = await sql`select * from interview.rounds where token_hash = ${hashToken(token)}`;
  if (!r || r.kind === 'human') throw notFound('Interview');
  if (r.status === 'cancelled') throw gone('This interview has been cancelled. Please contact the recruiter if you have questions.');
  if (r.status === 'expired' || (r.status === 'invited' && r.expiresAt && new Date(r.expiresAt) < new Date())) {
    await sql`update interview.rounds set status = 'expired' where id = ${r.id} and status = 'invited'`;
    throw gone('This interview link has expired. Please contact the recruiter to get a new link.');
  }
  return r;
}

function deadlineOf(r: Row): Date | null {
  return r.startedAt ? new Date(new Date(r.startedAt).getTime() + r.durationMin * 60_000) : null;
}

async function payload(r: Row) {
  const inProgress = r.status === 'in_progress';
  return {
    status: r.status,
    candidateName: r.candidateName,
    jobTitle: r.jobTitle,
    roundName: r.name,
    kind: r.kind,
    durationMin: r.durationMin,
    questionCount: r.questionCount,
    proctored: r.kind === 'ai_proctored',
    companyName: env.companyName,
    startedAt: r.startedAt,
    deadlineAt: deadlineOf(r),
    serverTime: new Date(),
    messages: inProgress ? await loadMessages(sql, r.id) : [],
  };
}

async function conversation(roundId: string) {
  const [r] = await sql`select status from interview.rounds where id = ${roundId}`;
  const done = r.status !== 'in_progress';
  return { messages: done ? [] : await loadMessages(sql, roundId), done };
}

export async function publicRoutes(app: FastifyInstance) {
  app.get('/public/interview/:token', async (req) => {
    const { token } = parse(tokenParams, req.params);
    return payload(await findByToken(token));
  });

  app.post('/public/interview/:token/start', async (req) => {
    const { token } = parse(tokenParams, req.params);
    const r = await findByToken(token);
    if (['completed', 'evaluated'].includes(r.status)) return { messages: [], done: true };
    if (r.status === 'invited') {
      await sql.begin(async (tx) => {
        const [u] = await tx`
          update interview.rounds set status = 'in_progress', started_at = now()
          where id = ${r.id} and status = 'invited' returning *
        `;
        if (u) {
          await publishEvent(tx, {
            type: 'interview.started',
            ...eventBase(r),
            payload: { candidateName: r.candidateName, jobTitle: r.jobTitle, roundName: r.name },
          });
        }
      });
    } else if (r.status !== 'in_progress') {
      throw conflict('This interview is not available.');
    }
    // Ask the first question, or regenerate a turn that failed previously.
    const { done } = await generateNextTurn(r.id, req.log);
    if (done) return { messages: [], done: true };
    return conversation(r.id);
  });

  app.post('/public/interview/:token/answer', async (req) => {
    const { token } = parse(tokenParams, req.params);
    const { content } = parse(z.object({ content: z.string().trim().min(1).max(8000) }), req.body);
    const r = await findByToken(token);
    if (['completed', 'evaluated'].includes(r.status)) return { messages: [], done: true };
    if (r.status !== 'in_progress') throw conflict('Please start the interview first.');

    const finished = await sql.begin(async (tx) => {
      const [locked] = await tx`select * from interview.rounds where id = ${r.id} for update`;
      if (locked.status !== 'in_progress') return true;
      const [last] = await tx`select seq, role from interview.messages where round_id = ${r.id} order by seq desc limit 1`;
      // If the last message is already the candidate's (a previous AI turn failed), treat this call as a retry.
      if (!last || last.role === 'interviewer') {
        await tx`
          insert into interview.messages (round_id, seq, role, content)
          values (${r.id}, ${(last?.seq ?? 0) + 1}, 'candidate', ${content})
        `;
      }
      const [{ answers }] = await tx`
        select count(*)::int as answers from interview.messages where round_id = ${r.id} and role = 'candidate'
      `;
      const deadline = deadlineOf(locked);
      const overTime = deadline !== null && Date.now() > deadline.getTime() + GRACE_MS;
      if (answers >= locked.questionCount || overTime) {
        await completeRound(tx, locked);
        return true;
      }
      return false;
    });

    if (finished) {
      void evaluateAiRound(r.id, req.log);
      return { messages: [], done: true };
    }
    const { done } = await generateNextTurn(r.id, req.log);
    if (done) return { messages: [], done: true };
    return conversation(r.id);
  });

  app.post('/public/interview/:token/proctor', async (req) => {
    const { token } = parse(tokenParams, req.params);
    const { events } = parse(
      z.object({
        events: z
          .array(
            z.object({
              type: z.enum(PROCTOR_EVENT_TYPES),
              details: z.record(z.unknown()).optional(),
              at: z.string().datetime({ offset: true }).optional(),
            }),
          )
          .min(1)
          .max(100),
      }),
      req.body,
    );
    const r = await findByToken(token);
    if (!['invited', 'in_progress'].includes(r.status)) return { ok: true };
    await sql`
      insert into interview.proctor_events ${sql(
        events.map((e) => ({
          roundId: r.id,
          eventType: e.type,
          details: sql.json((e.details ?? {}) as never),
          occurredAt: e.at ? new Date(e.at) : new Date(),
        })),
      )}
    `;
    return { ok: true };
  });
}
