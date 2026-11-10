import { z } from '@hireflow/shared';

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Lenient primitives: invalid / missing values fall back to safe defaults. */
export const str = z.preprocess((v) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : String(v)), z.string()).catch('');
export const nstr = z
  .preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().nullable().optional())
  .catch(null)
  .transform((v) => (v ? v : null));
export const strArr = z
  .preprocess((v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x: string) => x.trim()) : []), z.array(z.string()))
  .catch([]);
export const score100 = z.coerce
  .number()
  .catch(0)
  .transform((n) => clamp(Math.round(Number.isFinite(n) ? n : 0), 0, 100));
export const nnum = z
  .preprocess((v) => (v === null || v === undefined || v === '' ? null : Number(v)), z.number().nullable())
  .catch(null)
  .transform((n) => (n === null || !Number.isFinite(n) ? null : n));

export const parsedResumeSchema = z.object({
  fullName: nstr,
  email: nstr.transform((e) => (e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e.toLowerCase() : null)),
  phone: nstr,
  location: nstr,
  currentTitle: nstr,
  currentCompany: nstr,
  experienceYears: nnum.transform((n) => (n === null ? null : clamp(Math.round(n * 10) / 10, 0, 60))),
  linkedinUrl: nstr,
  portfolioUrl: nstr,
  summary: nstr,
  skills: strArr.transform((s) => {
    const seen = new Map<string, string>();
    for (const x of s) if (!seen.has(x.toLowerCase())) seen.set(x.toLowerCase(), x.slice(0, 60));
    return [...seen.values()].slice(0, 40);
  }),
  education: z
    .array(z.object({ degree: nstr, institution: nstr, year: nstr }))
    .catch([]),
  experience: z
    .array(z.object({ title: nstr, company: nstr, start: nstr, end: nstr, highlights: strArr }))
    .catch([]),
});

export const recommendation = z.enum(['strong_fit', 'good_fit', 'partial_fit', 'poor_fit']);
export const matchSchema = z
  .object({ score: score100, summary: str, strengths: strArr, gaps: strArr, recommendation: recommendation.catch('partial_fit') })
  .transform((m) => ({
    ...m,
    // keep recommendation consistent with the score
    recommendation: m.score >= 80 ? 'strong_fit' : m.score >= 65 ? 'good_fit' : m.score >= 40 ? 'partial_fit' : ('poor_fit' as const),
  }));

export const questionTypes = ['mcq', 'multi_select', 'short_text', 'long_text', 'code'] as const;
export type QuestionType = (typeof questionTypes)[number];

const rawQuestion = z.object({
  type: z.enum(questionTypes).catch('mcq'),
  prompt: str,
  options: z.array(z.coerce.string()).catch([]),
  correctOptions: z.array(z.coerce.number().int()).catch([]),
  points: z.coerce.number().int().catch(1),
  rubric: nstr,
});
export type GeneratedQuestion = { type: QuestionType; prompt: string; options: string[]; correctOptions: number[]; points: number; rubric: string | null };

/** Drops malformed questions and normalizes the rest. */
export function normalizeQuestions(input: unknown, allowed: QuestionType[]): GeneratedQuestion[] {
  const list = z.object({ questions: z.array(z.unknown()).catch([]) }).catch({ questions: [] }).parse(input).questions;
  const out: GeneratedQuestion[] = [];
  for (const item of list) {
    const r = rawQuestion.safeParse(item);
    if (!r.success) continue;
    const q = r.data;
    if (!q.prompt.trim() || !allowed.includes(q.type)) continue;
    const points = clamp(q.points || 1, 1, 10);
    if (q.type === 'mcq' || q.type === 'multi_select') {
      const options = q.options.map((o) => o.trim()).filter(Boolean).slice(0, 4);
      if (options.length !== 4) continue;
      let correct = [...new Set(q.correctOptions.filter((i) => i >= 0 && i < options.length))].sort();
      if (!correct.length) continue;
      if (q.type === 'mcq') correct = correct.slice(0, 1);
      out.push({ type: q.type, prompt: q.prompt.trim(), options, correctOptions: correct, points, rubric: null });
    } else {
      out.push({ type: q.type, prompt: q.prompt.trim(), options: [], correctOptions: [], points, rubric: q.rubric ?? 'Award full points for a correct, complete and well-reasoned answer; partial points for partially correct answers.' });
    }
  }
  return out;
}

export const interviewRecommendation = z.enum(['strong_hire', 'hire', 'lean_hire', 'lean_no_hire', 'no_hire']);
export const evaluationSchema = z
  .object({
    overallScore: score100,
    recommendation: interviewRecommendation.catch('lean_no_hire'),
    summary: str,
    strengths: strArr,
    concerns: strArr,
    competencies: z.array(z.object({ name: str, score: score100, comment: str })).catch([]),
  })
  .transform((e) => ({ ...e, competencies: e.competencies.filter((c) => c.name.trim()).slice(0, 8) }));

export const jdSchema = z.object({
  description: str,
  skills: z.array(z.object({ name: str, isRequired: z.coerce.boolean().catch(true) })).catch([]),
});

export const emailDraftSchema = z.object({ subject: str, bodyHtml: str });
