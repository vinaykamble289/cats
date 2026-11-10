// Frontend mirror of the API contract (docs/API.md)

export type Role = 'admin' | 'recruiter' | 'hiring_manager' | 'reviewer' | 'interviewer';

export interface Paginated<T> {
  data: T[];
  total: number;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  title: string | null;
  role: Role;
  departmentId: string | null;
  departmentName: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  hasLoggedIn: boolean;
}

export interface Department {
  id: string;
  name: string;
  userCount: number;
}

export type JobStatus = 'draft' | 'open' | 'on_hold' | 'closed' | 'filled';
export type RoundKind = 'ai_screening' | 'ai_proctored' | 'human';

export interface InterviewPlanRound {
  id?: string;
  sequence?: number;
  name: string;
  kind: RoundKind;
  durationMin: number;
  questionCount: number;
  passScore: number;
  focusAreas: string | null;
}

export interface Job {
  id: string;
  code: string;
  title: string;
  slug: string;
  departmentId: string | null;
  location: string | null;
  employmentType: 'full_time' | 'part_time' | 'contract' | 'internship';
  workMode: 'onsite' | 'remote' | 'hybrid';
  experienceMin: number | null;
  experienceMax: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string;
  openings: number;
  filled: number;
  description?: string;
  status: JobStatus;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  hiringManagerId: string | null;
  recruiterId: string | null;
  targetDate: string | null;
  publishedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  skills: { name: string; isRequired: boolean }[];
  reviewerIds: string[];
  interviewPlan?: InterviewPlanRound[];
}

export type ApplicationStage =
  | 'applied'
  | 'screening'
  | 'shortlisted'
  | 'assessment'
  | 'ai_interview'
  | 'interview'
  | 'offer'
  | 'pre_joining'
  | 'joined';
export type ApplicationStatus = 'active' | 'on_hold' | 'rejected' | 'withdrawn' | 'hired';

export interface Candidate {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  location: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  experienceYears: number | null;
  linkedinUrl: string | null;
  portfolioUrl: string | null;
  summary: string | null;
  source: string;
  sourceDetail: string | null;
  noticePeriodDays: number | null;
  currentCtc: number | null;
  expectedCtc: number | null;
  skills: string[];
  createdAt: string;
  updatedAt: string;
  applicationCount?: number;
}

export interface ParsedResume {
  education?: { degree?: string; institution?: string; year?: string }[];
  experience?: { title?: string; company?: string; start?: string; end?: string; highlights?: string[] }[];
  [k: string]: unknown;
}

export interface CandidateDetail extends Candidate {
  resume: { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string; parsed: ParsedResume | null } | null;
  applications: Application[];
}

export interface AiMatch {
  summary: string;
  strengths: string[];
  gaps: string[];
  recommendation: 'strong_fit' | 'good_fit' | 'partial_fit' | 'poor_fit';
}

export interface Application {
  id: string;
  candidateId: string;
  jobId: string;
  stage: ApplicationStage;
  status: ApplicationStatus;
  aiMatchScore: number | null;
  aiMatch: AiMatch | null;
  rejectionReason: string | null;
  appliedAt: string;
  stageChangedAt: string;
  updatedAt: string;
  candidate: {
    id: string;
    fullName: string;
    email: string;
    phone: string | null;
    currentTitle: string | null;
    currentCompany: string | null;
    experienceYears: number | null;
    location: string | null;
    skills: string[];
  };
  reviewSummary: { pending: number; completed: number; positive: number; negative: number; avgRating: number | null };
}

export interface StageHistoryItem {
  id: string;
  fromStage: ApplicationStage | null;
  toStage: ApplicationStage;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  note: string | null;
  changedBy: string | null;
  changedAt: string;
}

export type ReviewDecision = 'strong_yes' | 'yes' | 'maybe' | 'no';
export interface Review {
  id: string;
  applicationId: string;
  reviewerId: string;
  requestedBy: string | null;
  status: 'pending' | 'completed' | 'cancelled';
  decision: ReviewDecision | null;
  rating: number | null;
  comments: string | null;
  dueAt: string | null;
  requestedAt: string;
  submittedAt: string | null;
  application?: Application;
}

export interface ApplicationDetail extends Application {
  stageHistory: StageHistoryItem[];
  reviews: Review[];
}

export interface ApplicationStats {
  total: number;
  active: number;
  byStage: Partial<Record<ApplicationStage, number>>;
  byStatus: Partial<Record<ApplicationStatus, number>>;
  byJob: { jobId: string; total: number; active: number; byStage: Partial<Record<ApplicationStage, number>> }[];
  hiredThisMonth: number;
}

export type QuestionType = 'mcq' | 'multi_select' | 'short_text' | 'long_text' | 'code';
export interface Question {
  id?: string;
  position?: number;
  type: QuestionType;
  prompt: string;
  options: string[];
  correctOptions: number[];
  points: number;
  rubric: string | null;
}

export interface Test {
  id: string;
  title: string;
  description: string | null;
  jobId: string | null;
  durationMin: number;
  passPercent: number;
  shuffleQuestions: boolean;
  proctoringEnabled: boolean;
  status: 'draft' | 'active' | 'archived';
  questionCount: number;
  totalPoints: number;
  invitationCount: number;
  createdAt: string;
  updatedAt: string;
  questions?: Question[];
}

export type InvitationStatus = 'invited' | 'started' | 'submitted' | 'graded' | 'expired' | 'cancelled';
export interface Invitation {
  id: string;
  testId: string;
  testTitle: string;
  applicationId: string;
  candidateId: string;
  jobId: string | null;
  candidateName: string;
  candidateEmail: string;
  status: InvitationStatus;
  expiresAt: string;
  startedAt: string | null;
  deadlineAt: string | null;
  submittedAt: string | null;
  gradedAt: string | null;
  score: number | null;
  maxScore: number | null;
  percent: number | null;
  passed: boolean | null;
  integrityScore: number | null;
  aiSummary: string | null;
  createdAt: string;
}

export interface ProctoringSummary {
  counts: Record<string, number>;
  events: { eventType: string; details: Record<string, unknown>; occurredAt: string }[];
}

export interface InvitationDetail extends Invitation {
  answers: {
    questionId: string;
    position: number;
    prompt: string;
    type: QuestionType;
    options: string[];
    correctOptions: number[];
    points: number;
    response: unknown;
    isCorrect: boolean | null;
    pointsAwarded: number | null;
    aiFeedback: string | null;
  }[];
  proctoring: ProctoringSummary;
}

export type RoundStatus = 'pending' | 'invited' | 'scheduled' | 'in_progress' | 'completed' | 'evaluated' | 'cancelled' | 'expired' | 'no_show';
export type Recommendation = 'strong_hire' | 'hire' | 'lean_hire' | 'lean_no_hire' | 'no_hire';

export interface Evaluation {
  overallScore: number;
  recommendation: Recommendation;
  summary: string;
  strengths: string[];
  concerns: string[];
  competencies: { name: string; score: number; comment: string }[];
}

export interface Round {
  id: string;
  applicationId: string;
  candidateId: string;
  jobId: string;
  candidateName: string;
  candidateEmail: string;
  jobTitle: string;
  sequence: number;
  name: string;
  kind: RoundKind;
  status: RoundStatus;
  durationMin: number;
  questionCount: number;
  passScore: number;
  focusAreas: string | null;
  scheduledAt: string | null;
  meetingUrl: string | null;
  expiresAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  score: number | null;
  passed: boolean | null;
  recommendation: Recommendation | null;
  aiSummary: string | null;
  evaluation: Evaluation | null;
  integrityScore: number | null;
  interviewerIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Feedback {
  id: string;
  interviewerId: string;
  rating: number;
  recommendation: Recommendation;
  strengths: string | null;
  concerns: string | null;
  comments: string | null;
  submittedAt: string;
}

export interface RoundDetail extends Round {
  messages: { seq: number; role: 'interviewer' | 'candidate'; content: string; createdAt: string }[];
  feedback: Feedback[];
  proctoring: ProctoringSummary;
}

export type OfferStatus = 'draft' | 'sent' | 'negotiating' | 'accepted' | 'declined' | 'withdrawn' | 'expired';
export interface OfferVersion {
  id: string;
  version: number;
  designation: string;
  baseSalary: number;
  variablePay: number;
  joiningBonus: number;
  equity: string | null;
  currency: string;
  joiningDate: string | null;
  location: string | null;
  benefits: string | null;
  additionalTerms: string | null;
  createdAt: string;
}
export interface Offer {
  id: string;
  applicationId: string;
  candidateId: string;
  jobId: string;
  candidateName: string;
  candidateEmail: string;
  jobTitle: string;
  status: OfferStatus;
  currentVersion: number;
  expiresAt: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  declineReason: string | null;
  createdAt: string;
  updatedAt: string;
  current: OfferVersion;
}
export interface NegotiationMessage {
  id: string;
  actor: 'candidate' | 'recruiter';
  authorId: string | null;
  message: string;
  requestedBaseSalary: number | null;
  requestedJoiningDate: string | null;
  offerVersion: number | null;
  createdAt: string;
}
export interface OfferDetail extends Offer {
  versions: OfferVersion[];
  messages: NegotiationMessage[];
}

export type CaseStatus = 'collecting_documents' | 'documents_submitted' | 'bgv_in_progress' | 'bgv_cleared' | 'bgv_flagged' | 'joined' | 'dropped';
export interface OnboardingCase {
  id: string;
  applicationId: string;
  candidateId: string;
  jobId: string;
  offerId: string | null;
  candidateName: string;
  candidateEmail: string;
  jobTitle: string;
  joiningDate: string | null;
  status: CaseStatus;
  joinedAt: string | null;
  droppedReason: string | null;
  createdAt: string;
  updatedAt: string;
  documentStats: { total: number; uploaded: number; verified: number; rejected: number; requiredPending: number };
}
export interface CaseDocument {
  id: string;
  documentTypeId: string;
  code: string;
  name: string;
  description: string | null;
  isRequired: boolean;
  status: 'pending' | 'uploaded' | 'verified' | 'rejected';
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedAt: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
}
export interface BgvRequest {
  id: string;
  vendorId: string;
  vendorName: string;
  status: 'sent' | 'in_progress' | 'cleared' | 'flagged' | 'cancelled';
  referenceNo: string | null;
  sentAt: string;
  completedAt: string | null;
  resultSummary: string | null;
}
export interface OnboardingCaseDetail extends OnboardingCase {
  documents: CaseDocument[];
  bgvRequests: BgvRequest[];
}
export interface BgvVendor {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string;
  isActive: boolean;
}
export interface DocumentType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isRequired: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface EmailLog {
  id: string;
  toEmail: string;
  cc: string[];
  subject: string;
  templateKey: string | null;
  status: 'queued' | 'sending' | 'sent' | 'failed';
  attempts: number;
  lastError: string | null;
  relatedType: string | null;
  relatedId: string | null;
  candidateId: string | null;
  createdAt: string;
  sentAt: string | null;
  bodyHtml?: string;
}

export interface EmailTemplate {
  id: string;
  key: string;
  name: string;
  description: string | null;
  subject: string;
  bodyHtml: string;
  updatedAt: string;
}

export interface ActivityEvent {
  id: number;
  type: string;
  aggregateType: string;
  aggregateId: string;
  candidateId: string | null;
  jobId: string | null;
  applicationId: string | null;
  actorId: string | null;
  payload: Record<string, any>;
  createdAt: string;
}
