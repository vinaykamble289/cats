import { callService, publishEvent } from '@hireflow/shared';
import type { FastifyBaseLogger } from 'fastify';
import { sql } from '../db.js';
import { jobLookup } from './context.js';
import { integrityScore, proctorCounts } from './proctoring.js';
import type { QuestionType } from './questions.js';

interface QuestionRow {
  id: string;
  type: QuestionType;
  prompt: string;
  options: string[];
  correctOptions: number[];
  points: number;
  rubric: string | null;
  response: unknown;
  answerId: string | null;
}

const sameSet = (a: number[], b: number[]) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

/**
 * Grades a submitted invitation: choice questions exactly, text/code questions via AI (one batched call),
 * computes integrity score and a short summary, sets status 'graded'. Idempotent.
 */
export async function gradeInvitation(invitationId: string, log: FastifyBaseLogger): Promise<void> {
  const [inv] = await sql<{
    id: string;
    status: string;
    candidateId: string;
    applicationId: string;
    jobId: string | null;
    candidateName: string;
    testId: string;
    testTitle: string;
    passPercent: number;
    proctoringEnabled: boolean;
  }[]>`
    select i.id, i.status, i.candidate_id, i.application_id, i.job_id, i.candidate_name, i.test_id,
           t.title as test_title, t.pass_percent, t.proctoring_enabled
    from assessment.invitations i join assessment.tests t on t.id = i.test_id
    where i.id = ${invitationId}
  `;
  if (!inv || !['submitted', 'graded'].includes(inv.status)) return;

  const questions = await sql<QuestionRow[]>`
    select q.id, q.type, q.prompt, q.options, q.correct_options, q.points, q.rubric, a.response, a.id as answer_id
    from assessment.questions q
    left join assessment.answers a on a.question_id = q.id and a.invitation_id = ${invitationId}
    where q.test_id = ${inv.testId}
    order by q.position
  `;

  const results = new Map<string, { isCorrect: boolean | null; points: number; feedback: string | null }>();
  const textItems: { id: string; type: string; prompt: string; rubric: string | null; response: string; points: number }[] = [];
  let mcqTotal = 0;
  let mcqCorrect = 0;

  for (const q of questions) {
    if (q.type === 'mcq' || q.type === 'multi_select') {
      mcqTotal++;
      const correct =
        q.response !== null && q.response !== undefined
          ? q.type === 'mcq'
            ? Number(q.response) === q.correctOptions[0]
            : Array.isArray(q.response) && sameSet(q.response.map(Number), q.correctOptions.map(Number))
          : false;
      if (correct) mcqCorrect++;
      results.set(q.id, { isCorrect: correct, points: correct ? q.points : 0, feedback: null });
    } else {
      const text = typeof q.response === 'string' ? q.response.trim() : '';
      if (!text) results.set(q.id, { isCorrect: false, points: 0, feedback: 'No answer submitted.' });
      else textItems.push({ id: q.id, type: q.type, prompt: q.prompt, rubric: q.rubric, response: text, points: q.points });
    }
  }

  let aiFailed = false;
  if (textItems.length) {
    try {
      const r = await callService<{ results: { id: string; pointsAwarded: number; feedback: string }[] }>('ai', '/internal/assessment/grade', {
        method: 'POST',
        body: { items: textItems },
        timeoutMs: 120_000,
      });
      const byId = new Map(r.results.map((x) => [x.id, x]));
      for (const item of textItems) {
        const g = byId.get(item.id);
        const pts = Math.max(0, Math.min(item.points, Math.round((Number(g?.pointsAwarded) || 0) * 100) / 100));
        results.set(item.id, { isCorrect: pts >= item.points * 0.6, points: pts, feedback: g?.feedback ?? null });
      }
    } catch (err) {
      aiFailed = true;
      log.warn({ err: (err as Error).message, invitationId }, 'AI grading unavailable');
      for (const item of textItems) results.set(item.id, { isCorrect: null, points: 0, feedback: 'Pending manual review (AI grading was unavailable). Use "Re-grade" to retry.' });
    }
  }

  const maxScore = questions.reduce((s, q) => s + q.points, 0);
  const score = [...results.values()].reduce((s, r) => s + r.points, 0);
  const percent = maxScore ? Math.round((score / maxScore) * 10_000) / 100 : 0;
  const passed = percent >= inv.passPercent;
  const counts = inv.proctoringEnabled ? await proctorCounts(sql, invitationId) : {};
  const integrity = inv.proctoringEnabled ? integrityScore(counts) : null;

  const flags = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${n}× ${t.replace(/_/g, ' ')}`);
  const summary = [
    `Scored ${Math.round(score * 100) / 100}/${maxScore} (${percent}%) - ${passed ? 'passed' : 'below'} the ${inv.passPercent}% cut-off.`,
    mcqTotal ? `${mcqCorrect}/${mcqTotal} objective questions correct.` : null,
    textItems.length ? `${textItems.length} written answer(s) ${aiFailed ? 'awaiting manual review' : 'graded by AI'}.` : null,
    integrity !== null ? `Integrity ${integrity}/100${flags.length ? ` (${flags.join(', ')})` : ', no proctoring flags'}.` : null,
  ]
    .filter(Boolean)
    .join(' ');

  const job = await jobLookup()(inv.jobId);
  await sql.begin(async (tx) => {
    for (const q of questions) {
      const r = results.get(q.id)!;
      if (q.answerId) {
        await tx`update assessment.answers set is_correct = ${r.isCorrect}, points_awarded = ${r.points}, ai_feedback = ${r.feedback} where id = ${q.answerId}`;
      }
    }
    const [updated] = await tx`
      update assessment.invitations
      set status = 'graded', graded_at = now(), score = ${score}, max_score = ${maxScore}, percent = ${percent},
          passed = ${passed}, integrity_score = ${integrity}, ai_summary = ${summary}
      where id = ${invitationId} and status in ('submitted', 'graded')
      returning id
    `;
    if (!updated) return;
    await publishEvent(tx, {
      type: 'assessment.graded',
      aggregateType: 'invitation',
      aggregateId: inv.id,
      candidateId: inv.candidateId,
      jobId: inv.jobId,
      applicationId: inv.applicationId,
      payload: { candidateName: inv.candidateName, jobTitle: job?.title ?? null, testTitle: inv.testTitle, percent, passed, integrityScore: integrity },
    });
  });
}

/** Background grading (never throws). */
export function scheduleGrading(invitationId: string, log: FastifyBaseLogger): void {
  setImmediate(() => gradeInvitation(invitationId, log).catch((err) => log.error({ err, invitationId }, 'Grading failed')));
}
