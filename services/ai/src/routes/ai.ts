import type { FastifyInstance } from 'fastify';
import { getUser, optionalText, parse, requireRole, z } from '@hireflow/shared';
import { chatJson, isConfigured, models, truncate } from '../groq.js';
import * as P from '../prompts.js';
import {
  emailDraftSchema,
  evaluationSchema,
  interviewRecommendation,
  jdSchema,
  matchSchema,
  normalizeQuestions,
  parsedResumeSchema,
  questionTypes,
  str,
} from '../schemas.js';

const transcriptSchema = z
  .array(z.object({ role: z.enum(['interviewer', 'candidate']), content: z.string().max(20000) }))
  .max(200)
  .default([]);

function renderTranscript(t: { role: string; content: string }[]): string {
  return t.map((m) => `${m.role === 'interviewer' ? 'INTERVIEWER' : 'CANDIDATE'}: ${truncate(m.content, 4000)}`).join('\n\n');
}

export async function aiRoutes(app: FastifyInstance) {
  app.get('/ai/status', async (req) => {
    getUser(req);
    return { configured: isConfigured(), model: models.main() };
  });

  // ---------- resumes ----------
  app.post('/internal/resume/parse', async (req) => {
    const { text } = parse(z.object({ text: z.string().min(1) }), req.body);
    return chatJson({
      system: P.RESUME_PARSE,
      user: `Today's date: ${new Date().toISOString().slice(0, 10)}\n\nResume text:\n"""\n${truncate(text, 15000)}\n"""`,
      schema: parsedResumeSchema,
      fast: true,
      maxTokens: 3000,
      temperature: 0,
      log: req.log,
    });
  });

  app.post('/internal/resume/match', async (req) => {
    const b = parse(
      z.object({
        resumeText: z.string().min(1),
        job: z.object({
          title: z.string(),
          description: z.string().default(''),
          skills: z.array(z.union([z.string(), z.object({ name: z.string(), isRequired: z.boolean().optional() })])).default([]),
          experienceMin: z.number().nullish(),
          experienceMax: z.number().nullish(),
        }),
      }),
      req.body,
    );
    const skills = b.job.skills.map((s) => (typeof s === 'string' ? s : `${s.name}${s.isRequired === false ? ' (nice to have)' : ' (required)'}`));
    const exp =
      b.job.experienceMin != null || b.job.experienceMax != null ? `${b.job.experienceMin ?? 0}–${b.job.experienceMax ?? 'any'} years` : 'not specified';
    return chatJson({
      system: P.RESUME_MATCH,
      user: `JOB TITLE: ${b.job.title}\nREQUIRED EXPERIENCE: ${exp}\nSKILLS: ${skills.join(', ') || 'see description'}\nJOB DESCRIPTION:\n"""\n${truncate(b.job.description, 6000)}\n"""\n\nRESUME:\n"""\n${truncate(b.resumeText, 12000)}\n"""`,
      schema: matchSchema,
      temperature: 0,
      maxTokens: 1200,
      log: req.log,
    });
  });

  // ---------- assessments ----------
  app.post('/internal/assessment/generate', async (req) => {
    const b = parse(
      z.object({
        jobTitle: z.string().nullish(),
        jobDescription: z.string().nullish(),
        skills: z.array(z.string()).nullish(),
        count: z.coerce.number().int().min(1).max(30).default(10),
        difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
        types: z.array(z.enum(questionTypes)).min(1).default(['mcq']),
        topics: z.string().nullish(),
      }),
      req.body,
    );
    const user = `Create ${b.count} questions.
Difficulty: ${b.difficulty}.
Allowed question types: ${b.types.join(', ')} (distribute sensibly; mostly mcq if included).
Role: ${b.jobTitle || 'general'}
${b.skills?.length ? `Key skills: ${b.skills.join(', ')}` : ''}
${b.topics ? `Topics to cover: ${b.topics}` : ''}
${b.jobDescription ? `Job description:\n"""\n${truncate(b.jobDescription, 5000)}\n"""` : ''}`;
    const result = await chatJson({
      system: P.ASSESSMENT_GENERATE,
      user,
      schema: z.unknown().transform((v) => normalizeQuestions(v, b.types)),
      temperature: 0.5,
      maxTokens: Math.min(8000, 400 * b.count + 500),
      log: req.log,
    });
    return { questions: result.slice(0, b.count) };
  });

  app.post('/internal/assessment/grade', async (req) => {
    const b = parse(
      z.object({
        items: z
          .array(
            z.object({
              id: z.string(),
              type: z.string().default('long_text'),
              prompt: z.string(),
              rubric: z.string().nullish(),
              response: z.unknown(),
              points: z.coerce.number().positive(),
            }),
          )
          .max(100),
      }),
      req.body,
    );
    const results: { id: string; pointsAwarded: number; feedback: string }[] = [];
    const toGrade = [];
    for (const item of b.items) {
      const response = typeof item.response === 'string' ? item.response.trim() : item.response == null ? '' : JSON.stringify(item.response);
      if (!response) results.push({ id: item.id, pointsAwarded: 0, feedback: 'No answer provided.' });
      else toGrade.push({ ...item, response });
    }
    // grade in chunks to keep prompts focused
    for (let i = 0; i < toGrade.length; i += 8) {
      const chunk = toGrade.slice(i, i + 8);
      const payload = chunk.map((it) => ({
        id: it.id,
        type: it.type,
        maxPoints: it.points,
        question: truncate(it.prompt, 3000),
        rubric: it.rubric ?? 'Award points for correctness and completeness.',
        response: truncate(it.response, 6000),
      }));
      const graded = await chatJson({
        system: P.ASSESSMENT_GRADE,
        user: `Items to grade (JSON):\n${JSON.stringify(payload, null, 2)}`,
        schema: z.object({
          results: z.array(z.object({ id: z.coerce.string(), pointsAwarded: z.coerce.number().catch(0), feedback: str })).catch([]),
        }),
        temperature: 0,
        maxTokens: 2000,
        log: req.log,
      });
      const byId = new Map(graded.results.map((r) => [r.id, r]));
      for (const it of chunk) {
        const r = byId.get(it.id);
        const pts = r ? Math.max(0, Math.min(it.points, Math.round(r.pointsAwarded * 2) / 2)) : 0;
        results.push({ id: it.id, pointsAwarded: pts, feedback: r?.feedback || 'Could not be graded automatically - please review.' });
      }
    }
    return { results };
  });

  // ---------- interviews ----------
  app.post('/internal/interview/next', async (req) => {
    const b = parse(
      z.object({
        candidateName: z.string().default('there'),
        jobTitle: z.string(),
        jobContext: z.string().nullish(),
        roundName: z.string().default('Interview'),
        kind: z.string().default('ai_screening'),
        focusAreas: z.string().nullish(),
        questionCount: z.coerce.number().int().min(1).max(30).default(6),
        transcript: transcriptSchema,
      }),
      req.body,
    );
    const answered = b.transcript.filter((m) => m.role === 'candidate').length;
    const firstName = b.candidateName.split(' ')[0] || 'there';
    if (answered >= b.questionCount) {
      return {
        message: `Thank you, ${firstName}. That was the last question - this concludes the ${b.roundName}. We appreciate your time, and our team will review your responses and get back to you soon. You can close this window now.`,
        done: true,
      };
    }
    const system = P.interviewerPrompt({
      candidateName: b.candidateName,
      jobTitle: b.jobTitle,
      jobContext: truncate(b.jobContext, 4000),
      roundName: b.roundName,
      kind: b.kind,
      focusAreas: b.focusAreas ?? '',
      questionCount: b.questionCount,
      questionNumber: answered + 1,
    });
    const user = b.transcript.length
      ? `Transcript so far:\n${renderTranscript(b.transcript.slice(-24))}\n\nWrite your next message (question ${answered + 1} of ${b.questionCount}).`
      : 'The candidate has just joined. Write your opening message with question 1.';
    const res = await chatJson({
      system,
      user,
      schema: z.object({ message: str }),
      temperature: 0.6,
      maxTokens: 400,
      log: req.log,
    });
    const message = res.message.trim() || `Question ${answered + 1}: Could you tell me about a recent project relevant to the ${b.jobTitle} role and your specific contribution?`;
    return { message, done: false };
  });

  app.post('/internal/interview/evaluate', async (req) => {
    const b = parse(
      z.object({
        jobTitle: z.string(),
        jobContext: z.string().nullish(),
        roundName: z.string().default('Interview'),
        focusAreas: z.string().nullish(),
        transcript: transcriptSchema,
      }),
      req.body,
    );
    const answers = b.transcript.filter((m) => m.role === 'candidate' && m.content.trim());
    if (!answers.length) {
      return {
        overallScore: 0,
        recommendation: interviewRecommendation.enum.no_hire,
        summary: 'The candidate did not answer any questions.',
        strengths: [],
        concerns: ['No answers were provided.'],
        competencies: [],
      };
    }
    return chatJson({
      system: P.INTERVIEW_EVALUATE,
      user: `ROLE: ${b.jobTitle}\nROUND: ${b.roundName}\nFOCUS AREAS: ${b.focusAreas || 'core role competencies'}\nJOB CONTEXT:\n"""\n${truncate(b.jobContext, 3000)}\n"""\n\nTRANSCRIPT:\n${renderTranscript(b.transcript)}`,
      schema: evaluationSchema,
      temperature: 0,
      maxTokens: 1800,
      log: req.log,
    });
  });

  // ---------- HR-facing helpers ----------
  app.post('/ai/job-description', async (req) => {
    requireRole(req, 'recruiter');
    const b = parse(
      z.object({
        title: z.string().trim().min(1).max(200),
        department: optionalText(120),
        location: optionalText(200),
        employmentType: optionalText(40),
        workMode: optionalText(40),
        experienceMin: z.coerce.number().nullish(),
        experienceMax: z.coerce.number().nullish(),
        skills: z.array(z.string()).max(40).nullish(),
        notes: optionalText(4000),
      }),
      req.body,
    );
    const lines = [
      `Job title: ${b.title}`,
      b.department && `Department: ${b.department}`,
      b.location && `Location: ${b.location}`,
      b.employmentType && `Employment type: ${b.employmentType}`,
      b.workMode && `Work mode: ${b.workMode}`,
      (b.experienceMin != null || b.experienceMax != null) && `Experience: ${b.experienceMin ?? 0}-${b.experienceMax ?? '+'} years`,
      b.skills?.length && `Key skills: ${b.skills.join(', ')}`,
      b.notes && `Hiring manager notes: ${b.notes}`,
    ].filter(Boolean);
    const res = await chatJson({ system: P.JOB_DESCRIPTION, user: lines.join('\n'), schema: jdSchema, temperature: 0.6, maxTokens: 2500, log: req.log });
    const seen = new Set<string>();
    const skills = res.skills
      .map((s) => ({ name: s.name.trim().slice(0, 80), isRequired: s.isRequired }))
      .filter((s) => s.name && !seen.has(s.name.toLowerCase()) && seen.add(s.name.toLowerCase()))
      .slice(0, 15);
    return { description: res.description.trim(), skills };
  });

  app.post('/ai/email-draft', async (req) => {
    requireRole(req, 'recruiter');
    const b = parse(
      z.object({
        purpose: z.string().trim().min(1).max(500),
        candidateName: optionalText(120),
        jobTitle: optionalText(200),
        tone: optionalText(40),
        notes: optionalText(3000),
      }),
      req.body,
    );
    const user = [
      `Purpose: ${b.purpose}`,
      b.candidateName && `Candidate name: ${b.candidateName}`,
      b.jobTitle && `Role: ${b.jobTitle}`,
      `Tone: ${b.tone || 'warm and professional'}`,
      b.notes && `Notes / details to include: ${b.notes}`,
    ]
      .filter(Boolean)
      .join('\n');
    return chatJson({ system: P.EMAIL_DRAFT, user, schema: emailDraftSchema, temperature: 0.6, maxTokens: 1000, log: req.log });
  });
}
