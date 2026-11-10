import { conflict, optionalText, z, type Db } from '@hireflow/shared';
import { createHash } from 'node:crypto';

export const QUESTION_TYPES = ['mcq', 'multi_select', 'short_text', 'long_text', 'code'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const isChoice = (t: QuestionType) => t === 'mcq' || t === 'multi_select';

export const questionSchema = z
  .object({
    type: z.enum(QUESTION_TYPES),
    prompt: z.string().trim().min(1).max(10_000),
    options: z.array(z.string().trim().min(1).max(1000)).max(10).default([]),
    correctOptions: z.array(z.coerce.number().int().min(0)).max(10).default([]),
    points: z.coerce.number().int().min(1).max(100).default(1),
    rubric: optionalText(5000),
  })
  .transform((q) => (isChoice(q.type) ? q : { ...q, options: [], correctOptions: [] }))
  .superRefine((q, ctx) => {
    if (!isChoice(q.type)) return;
    if (q.options.length < 2) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Choice questions need at least 2 options' });
    const correct = [...new Set(q.correctOptions)];
    if (!correct.length) ctx.addIssue({ code: 'custom', path: ['correctOptions'], message: 'Mark the correct option' });
    if (correct.some((i) => i >= q.options.length)) ctx.addIssue({ code: 'custom', path: ['correctOptions'], message: 'Correct option out of range' });
    if (q.type === 'mcq' && correct.length !== 1) ctx.addIssue({ code: 'custom', path: ['correctOptions'], message: 'Single-choice questions have exactly one correct option' });
  });

export type QuestionInput = z.output<typeof questionSchema>;

/** Questions can't be replaced/removed once candidates have answers stored against them. */
export async function assertQuestionsEditable(tx: Db, testId: string): Promise<void> {
  const [row] = await tx<{ n: number }[]>`
    select count(*)::int as n from assessment.invitations
    where test_id = ${testId} and status in ('started', 'submitted', 'graded')
  `;
  if (row!.n > 0) throw conflict('Candidates have already taken this test, so its questions can no longer be replaced. Duplicate it as a new test instead.');
}

/** Inserts questions starting at the given position. */
export async function insertQuestions(tx: Db, testId: string, questions: QuestionInput[], startPosition = 1): Promise<void> {
  let position = startPosition;
  for (const q of questions) {
    await tx`
      insert into assessment.questions (test_id, position, type, prompt, options, correct_options, points, rubric)
      values (${testId}, ${position++}, ${q.type}, ${q.prompt}, ${tx.json(q.options as never)}, ${tx.json([...new Set(q.correctOptions)] as never)},
              ${q.points}, ${q.rubric ?? null})
    `;
  }
}

/** Deterministic per-invitation shuffle (stable across reloads). */
export function shuffleFor<T extends { id: string }>(items: T[], seed: string): T[] {
  const key = (id: string) => createHash('sha1').update(seed + id).digest('hex');
  return [...items].sort((a, b) => (key(a.id) < key(b.id) ? -1 : 1));
}

/** Validates a candidate response for a question type. Returns the normalized value or throws. */
export function normalizeResponse(type: QuestionType, optionCount: number, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (type === 'mcq') {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n >= optionCount) throw new Error('Invalid option');
    return n;
  }
  if (type === 'multi_select') {
    if (!Array.isArray(value)) throw new Error('Expected a list of options');
    const arr = [...new Set(value.map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n < optionCount).sort((a, b) => a - b);
    return arr;
  }
  if (typeof value !== 'string') throw new Error('Expected text');
  return value.slice(0, 20_000);
}
