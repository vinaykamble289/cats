export const ROLES = ['admin', 'recruiter', 'hiring_manager', 'reviewer', 'interviewer'] as const;
export type Role = (typeof ROLES)[number];

/** Roles that run the hiring process (full access to pipeline operations). */
export const HR_ROLES: Role[] = ['admin', 'recruiter'];
/** Anyone on the hiring team who can read candidate data. */
export const TEAM_ROLES: Role[] = ['admin', 'recruiter', 'hiring_manager', 'reviewer', 'interviewer'];

export const APPLICATION_STAGES = [
  'applied',
  'screening',
  'shortlisted',
  'assessment',
  'ai_interview',
  'interview',
  'offer',
  'pre_joining',
  'joined',
] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

export const APPLICATION_STATUSES = ['active', 'on_hold', 'rejected', 'withdrawn', 'hired'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  name: string;
}

/** Shape returned by talent-service GET /internal/applications/:id */
export interface ApplicationContext {
  id: string;
  candidateId: string;
  jobId: string;
  stage: ApplicationStage;
  status: ApplicationStatus;
  candidateName: string;
  candidateEmail: string;
  candidatePhone: string | null;
  resumeText: string | null;
}

/** Shape returned by jobs-service GET /internal/jobs/:id */
export interface JobContext {
  id: string;
  code: string;
  title: string;
  slug: string;
  status: string;
  description: string;
  location: string | null;
  departmentId: string | null;
  recruiterId: string | null;
  hiringManagerId: string | null;
  currency: string;
  skills: { name: string; isRequired: boolean }[];
  reviewerIds: string[];
  interviewPlan: {
    sequence: number;
    name: string;
    kind: 'ai_screening' | 'ai_proctored' | 'human';
    durationMin: number;
    questionCount: number;
    passScore: number;
    focusAreas: string | null;
  }[];
}

export interface Paginated<T> {
  data: T[];
  total: number;
}
