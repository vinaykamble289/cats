import { callService, publishEvent, type ApplicationStage, type ApplicationStatus, type Db, type JobContext } from '@hireflow/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { PendingQuery, Row } from 'postgres';
import { sql } from '../db.js';
import { getJob } from './jobs.js';

type Fragment = PendingQuery<Row[]>;

/** Candidate columns + skills array (alias c). */
export const candidateColumns = () => sql`
  c.id, c.full_name, c.email, c.phone, c.location, c.current_title, c.current_company, c.experience_years,
  c.linkedin_url, c.portfolio_url, c.summary, c.source, c.source_detail, c.notice_period_days,
  c.current_ctc, c.expected_ctc, c.created_at, c.updated_at,
  coalesce((select array_agg(s.name order by s.name) from talent.candidate_skills s where s.candidate_id = c.id), '{}') as skills
`;

export interface ApplicationRow {
  id: string;
  candidateId: string;
  jobId: string;
  stage: ApplicationStage;
  status: ApplicationStatus;
  aiMatchScore: number | null;
  aiMatch: unknown;
  rejectionReason: string | null;
  appliedAt: Date;
  stageChangedAt: Date;
  updatedAt: Date;
  candidate: Record<string, unknown>;
  reviewSummary: Record<string, unknown>;
}

/**
 * Fetches applications with embedded candidate + review summary in one query.
 * `where` is a fragment starting with `and ...` (alias a = application, c = candidate).
 */
export async function queryApplications(where: Fragment, opts: { limit?: number; offset?: number; order?: Fragment } = {}): Promise<ApplicationRow[]> {
  return sql<ApplicationRow[]>`
    select a.id, a.candidate_id, a.job_id, a.stage, a.status, a.ai_match_score, a.ai_match, a.rejection_reason,
           a.applied_at, a.stage_changed_at, a.updated_at,
           json_build_object(
             'id', c.id, 'fullName', c.full_name, 'email', c.email, 'phone', c.phone,
             'currentTitle', c.current_title, 'currentCompany', c.current_company,
             'experienceYears', c.experience_years, 'location', c.location,
             'skills', coalesce(sk.skills, '[]'::json)
           ) as candidate,
           json_build_object(
             'pending', coalesce(rv.pending, 0), 'completed', coalesce(rv.completed, 0),
             'positive', coalesce(rv.positive, 0), 'negative', coalesce(rv.negative, 0),
             'avgRating', rv.avg_rating
           ) as review_summary
    from talent.applications a
    join talent.candidates c on c.id = a.candidate_id
    left join lateral (
      select json_agg(s.name order by s.name) as skills from talent.candidate_skills s where s.candidate_id = c.id
    ) sk on true
    left join lateral (
      select count(*) filter (where r.status = 'pending')::int as pending,
             count(*) filter (where r.status = 'completed')::int as completed,
             count(*) filter (where r.decision in ('strong_yes', 'yes'))::int as positive,
             count(*) filter (where r.decision = 'no')::int as negative,
             round(avg(r.rating)::numeric, 1)::float8 as avg_rating
      from talent.reviews r where r.application_id = a.id and r.status <> 'cancelled'
    ) rv on true
    where true ${where}
    ${opts.order ?? sql`order by a.stage_changed_at desc`}
    ${opts.limit !== undefined ? sql`limit ${opts.limit}` : sql``}
    ${opts.offset ? sql`offset ${opts.offset}` : sql``}
  `;
}

export interface TransitionInput {
  stage?: ApplicationStage;
  status?: ApplicationStatus;
  note?: string | null;
  rejectionReason?: string | null;
  actorId?: string | null;
  jobTitle?: string | null;
}

export interface TransitionResult {
  changed: boolean;
  applicationId: string;
  candidateId: string;
  jobId: string;
  candidateName: string;
  candidateEmail: string;
  fromStage: ApplicationStage;
  toStage: ApplicationStage;
  fromStatus: ApplicationStatus;
  toStatus: ApplicationStatus;
}

/** Moves an application (locks the row). Writes stage history + event. No-op when nothing changes. */
export async function transitionApplication(tx: Db, applicationId: string, input: TransitionInput): Promise<TransitionResult | null> {
  const [app] = await tx<{ id: string; candidateId: string; jobId: string; stage: ApplicationStage; status: ApplicationStatus; fullName: string; email: string }[]>`
    select a.id, a.candidate_id, a.job_id, a.stage, a.status, c.full_name, c.email
    from talent.applications a join talent.candidates c on c.id = a.candidate_id
    where a.id = ${applicationId}
    for update of a
  `;
  if (!app) return null;
  const toStage = input.stage ?? app.stage;
  const toStatus = input.status ?? app.status;
  const base = {
    applicationId: app.id,
    candidateId: app.candidateId,
    jobId: app.jobId,
    candidateName: app.fullName,
    candidateEmail: app.email,
    fromStage: app.stage,
    toStage,
    fromStatus: app.status,
    toStatus,
  };
  if (toStage === app.stage && toStatus === app.status) return { ...base, changed: false };

  const rejectionReason = toStatus === 'rejected' ? (input.rejectionReason ?? null) : null;
  await tx`
    update talent.applications
    set stage = ${toStage}, status = ${toStatus}, rejection_reason = ${rejectionReason},
        stage_changed_at = case when ${toStage}::talent.application_stage <> stage then now() else stage_changed_at end
    where id = ${app.id}
  `;
  await tx`
    insert into talent.stage_history (application_id, from_stage, to_stage, from_status, to_status, note, changed_by)
    values (${app.id}, ${app.stage}, ${toStage}, ${app.status}, ${toStatus}, ${input.note ?? rejectionReason ?? null}, ${input.actorId ?? null})
  `;
  await publishEvent(tx, {
    type: 'application.stage_changed',
    aggregateType: 'application',
    aggregateId: app.id,
    candidateId: app.candidateId,
    jobId: app.jobId,
    applicationId: app.id,
    actorId: input.actorId ?? null,
    payload: {
      candidateName: app.fullName,
      jobTitle: input.jobTitle ?? null,
      fromStage: app.stage,
      toStage,
      fromStatus: app.status,
      toStatus,
      note: input.note ?? null,
      rejectionReason,
    },
  });
  return { ...base, changed: true };
}

/** Creates an application (idempotent). Returns id + whether it was created. Must run inside a transaction. */
export async function createApplication(
  tx: Db,
  input: { candidateId: string; candidateName: string; jobId: string; jobTitle: string | null; actorId: string | null; source?: string },
): Promise<{ id: string; created: boolean }> {
  const [row] = await tx<{ id: string }[]>`
    insert into talent.applications (candidate_id, job_id, created_by)
    values (${input.candidateId}, ${input.jobId}, ${input.actorId})
    on conflict (candidate_id, job_id) do nothing
    returning id
  `;
  if (!row) {
    const [existing] = await tx<{ id: string }[]>`select id from talent.applications where candidate_id = ${input.candidateId} and job_id = ${input.jobId}`;
    return { id: existing!.id, created: false };
  }
  await tx`
    insert into talent.stage_history (application_id, from_stage, to_stage, from_status, to_status, note, changed_by)
    values (${row.id}, null, 'applied', null, 'active', ${input.source ? `Source: ${input.source}` : null}, ${input.actorId})
  `;
  await publishEvent(tx, {
    type: 'application.created',
    aggregateType: 'application',
    aggregateId: row.id,
    candidateId: input.candidateId,
    jobId: input.jobId,
    applicationId: row.id,
    actorId: input.actorId,
    payload: { candidateName: input.candidateName, jobTitle: input.jobTitle, source: input.source ?? null },
  });
  return { id: row.id, created: true };
}

interface MatchResult {
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
  recommendation: string;
}

/** Computes and stores the AI match score for an application. Throws on failure. */
export async function runAiMatch(applicationId: string, job?: JobContext): Promise<void> {
  const [app] = await sql<{ id: string; candidateId: string; jobId: string; fullName: string; resumeText: string | null }[]>`
    select a.id, a.candidate_id, a.job_id, c.full_name,
           (select r.text_content from talent.resumes r where r.candidate_id = c.id and r.is_primary limit 1) as resume_text
    from talent.applications a join talent.candidates c on c.id = a.candidate_id
    where a.id = ${applicationId}
  `;
  if (!app || !app.resumeText || app.resumeText.length < 40) return;
  const j = job ?? (await getJob(app.jobId));
  const r = await callService<MatchResult>('ai', '/internal/resume/match', {
    method: 'POST',
    timeoutMs: 60_000,
    body: { resumeText: app.resumeText, job: { title: j.title, description: j.description, skills: j.skills.map((s) => s.name) } },
  });
  const score = Math.max(0, Math.min(100, Math.round(Number(r.score) || 0)));
  const aiMatch = {
    summary: String(r.summary ?? ''),
    strengths: Array.isArray(r.strengths) ? r.strengths.map(String).slice(0, 8) : [],
    gaps: Array.isArray(r.gaps) ? r.gaps.map(String).slice(0, 8) : [],
    recommendation: ['strong_fit', 'good_fit', 'partial_fit', 'poor_fit'].includes(r.recommendation) ? r.recommendation : score >= 75 ? 'good_fit' : score >= 50 ? 'partial_fit' : 'poor_fit',
  };
  await sql.begin(async (tx) => {
    await tx`update talent.applications set ai_match_score = ${score}, ai_match = ${tx.json(aiMatch as never)} where id = ${app.id}`;
    await publishEvent(tx, {
      type: 'application.ai_matched',
      aggregateType: 'application',
      aggregateId: app.id,
      candidateId: app.candidateId,
      jobId: app.jobId,
      applicationId: app.id,
      payload: { candidateName: app.fullName, jobTitle: j.title, score },
    });
  });
}

/** Fire-and-forget AI match (never throws). */
export function scheduleAiMatch(applicationIds: string[], log: FastifyBaseLogger): void {
  if (!applicationIds.length) return;
  setImmediate(async () => {
    for (const id of applicationIds) {
      try {
        await runAiMatch(id);
      } catch (err) {
        log.warn({ err: (err as Error).message, applicationId: id }, 'AI match failed');
      }
    }
  });
}
