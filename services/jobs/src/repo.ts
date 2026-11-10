import { randomBytes } from 'node:crypto';
import type { Db, JobContext } from '@hireflow/shared';
import { sql } from './db.js';

export type JobStatus = 'draft' | 'open' | 'on_hold' | 'closed' | 'filled';
export type RoundKind = 'ai_screening' | 'ai_proctored' | 'human';

export interface PlanRound {
  id?: string;
  sequence: number;
  name: string;
  kind: RoundKind;
  durationMin: number;
  questionCount: number;
  passScore: number;
  focusAreas: string | null;
}

export interface JobRow {
  id: string;
  code: string;
  title: string;
  slug: string;
  departmentId: string | null;
  location: string | null;
  employmentType: string;
  workMode: string;
  experienceMin: number | null;
  experienceMax: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string;
  openings: number;
  filled: number;
  description?: string;
  status: JobStatus;
  priority: string;
  hiringManagerId: string | null;
  recruiterId: string | null;
  targetDate: string | null;
  publishedAt: Date | null;
  closedAt: Date | null;
  closeReason: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  skills: { name: string; isRequired: boolean }[];
  reviewerIds: string[];
  interviewPlan?: PlanRound[];
}

export const DEFAULT_PLAN: Omit<PlanRound, 'sequence'>[] = [
  { name: 'AI Screening', kind: 'ai_screening', durationMin: 20, questionCount: 6, passScore: 60, focusAreas: 'Motivation, communication, relevant experience and role fit' },
  { name: 'Technical Interview', kind: 'ai_proctored', durationMin: 45, questionCount: 8, passScore: 65, focusAreas: 'Core technical skills required for the role, problem solving' },
  { name: 'Hiring Manager Round', kind: 'human', durationMin: 45, questionCount: 6, passScore: 60, focusAreas: null },
];

export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .slice(0, 60)
    .replace(/-+$/, '');
  const suffix = randomBytes(4).toString('hex').slice(0, 6);
  return `${base || 'job'}-${suffix}`;
}

/** Columns shared by list + detail queries (description optional). */
function jobColumns(db: Db, withDescription: boolean) {
  return db`
    j.id, j.code, j.title, j.slug, j.department_id, j.location, j.employment_type, j.work_mode,
    j.experience_min, j.experience_max, j.salary_min, j.salary_max, j.currency, j.openings, j.filled,
    ${withDescription ? db`j.description,` : db``}
    j.status, j.priority, j.hiring_manager_id, j.recruiter_id, j.target_date, j.published_at, j.closed_at,
    j.close_reason, j.created_by, j.created_at, j.updated_at,
    coalesce((select json_agg(json_build_object('name', s.name, 'isRequired', s.is_required) order by s.is_required desc, lower(s.name))
              from jobs.job_skills s where s.job_id = j.id), '[]'::json) as skills,
    coalesce((select json_agg(r.user_id) from jobs.job_reviewers r where r.job_id = j.id), '[]'::json) as reviewer_ids
  `;
}

export async function getJob(db: Db, where: { id?: string; slug?: string; code?: string }): Promise<JobRow | undefined> {
  const cond = where.id ? db`j.id = ${where.id}` : where.code ? db`upper(j.code) = ${where.code.toUpperCase()}` : db`j.slug = ${where.slug ?? ''}`;
  const [job] = await db<JobRow[]>`select ${jobColumns(db, true)} from jobs.jobs j where ${cond}`;
  if (!job) return undefined;
  job.interviewPlan = await db<PlanRound[]>`
    select id, sequence, name, kind, duration_min, question_count, pass_score, focus_areas
    from jobs.interview_plan_rounds where job_id = ${job.id} order by sequence`;
  return job;
}

export async function listJobs(
  db: Db,
  f: { status?: string[]; q?: string; departmentId?: string; ids?: string[]; limit: number; offset: number },
): Promise<{ data: JobRow[]; total: number }> {
  const term = f.q ? `%${f.q}%` : null;
  const where = db`
    where true
    ${f.status?.length ? db`and j.status::text = any(${db.array(f.status)}::text[])` : db``}
    ${term ? db`and (j.title ilike ${term} or j.code ilike ${term} or j.location ilike ${term})` : db``}
    ${f.departmentId ? db`and j.department_id = ${f.departmentId}` : db``}
    ${f.ids?.length ? db`and j.id = any(${db.array(f.ids)}::uuid[])` : db``}
  `;
  const [data, [{ total }]] = await Promise.all([
    db<JobRow[]>`
      select ${jobColumns(db, false)} from jobs.jobs j ${where}
      order by (j.status = 'open') desc,
               array_position(array['urgent','high','medium','low']::text[], j.priority::text),
               j.created_at desc
      limit ${f.limit} offset ${f.offset}`,
    db<{ total: number }[]>`select count(*)::int as total from jobs.jobs j ${where}`,
  ]);
  return { data, total };
}

function dedupeSkills(skills: { name: string; isRequired: boolean }[]) {
  const seen = new Map<string, { name: string; isRequired: boolean }>();
  for (const s of skills) {
    const name = s.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const prev = seen.get(key);
    seen.set(key, { name, isRequired: (prev?.isRequired ?? false) || s.isRequired });
  }
  return [...seen.values()];
}

export async function replaceSkills(db: Db, jobId: string, skills: { name: string; isRequired: boolean }[]) {
  await db`delete from jobs.job_skills where job_id = ${jobId}`;
  const rows = dedupeSkills(skills).map((s) => ({ jobId, name: s.name, isRequired: s.isRequired }));
  if (rows.length) await db`insert into jobs.job_skills ${db(rows, 'jobId', 'name', 'isRequired')}`;
}

export async function replaceReviewers(db: Db, jobId: string, reviewerIds: string[]) {
  await db`delete from jobs.job_reviewers where job_id = ${jobId}`;
  const rows = [...new Set(reviewerIds)].map((userId) => ({ jobId, userId }));
  if (rows.length) await db`insert into jobs.job_reviewers ${db(rows, 'jobId', 'userId')}`;
}

export async function replacePlan(db: Db, jobId: string, plan: Omit<PlanRound, 'sequence' | 'id'>[]) {
  await db`delete from jobs.interview_plan_rounds where job_id = ${jobId}`;
  const rows = plan.map((r, i) => ({
    jobId,
    sequence: i + 1,
    name: r.name,
    kind: r.kind,
    durationMin: r.durationMin,
    questionCount: r.questionCount,
    passScore: r.passScore,
    focusAreas: r.focusAreas ?? null,
  }));
  if (rows.length) {
    await db`insert into jobs.interview_plan_rounds ${db(rows, 'jobId', 'sequence', 'name', 'kind', 'durationMin', 'questionCount', 'passScore', 'focusAreas')}`;
  }
}

export function toJobContext(job: JobRow): JobContext {
  return {
    id: job.id,
    code: job.code,
    title: job.title,
    slug: job.slug,
    status: job.status,
    description: job.description ?? '',
    location: job.location,
    departmentId: job.departmentId,
    recruiterId: job.recruiterId,
    hiringManagerId: job.hiringManagerId,
    currency: job.currency,
    skills: job.skills,
    reviewerIds: job.reviewerIds,
    interviewPlan: (job.interviewPlan ?? []).map((r) => ({
      sequence: r.sequence,
      name: r.name,
      kind: r.kind,
      durationMin: r.durationMin,
      questionCount: r.questionCount,
      passScore: r.passScore,
      focusAreas: r.focusAreas,
    })),
  };
}

export { sql };
