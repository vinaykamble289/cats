# HireFlow API contract

All browser traffic goes through the **gateway** (`http://localhost:4000`).

* Authenticated: `/api/<resource>/...` with `Authorization: Bearer <supabase access token>` → forwarded to the owning service as `/<resource>/...` with `x-internal-key` + `x-user-id|email|role|name` headers.
* Public candidate portal: `/api/public/<prefix>/...` → `/public/<prefix>/...` (no login, secured by unguessable tokens; stricter rate limit).
* Service-to-service: `/internal/...` called with `callService()` from `@hireflow/shared` (internal key required).

**Conventions**
* JSON is camelCase (DB columns are converted automatically by `createDb`).
* Lists return `{ data: T[], total: number }`, paging via `?page=1&pageSize=25`.
* Errors return `{ error: { code, message, details? } }` with proper HTTP status.
* Dates: timestamps ISO strings; `date` columns are `YYYY-MM-DD` strings. Money = numbers.
* "HR" = roles `admin`/`recruiter` (`requireRole(req, 'recruiter')` — admin always passes).
* Every state change publishes a domain event (`publishEvent(tx, …)`) **inside the same transaction**. Event payloads carry readable fields (`candidateName`, `jobTitle`, `from`, `to`, …) so the activity feed renders without joins.
* Services import `z` from `@hireflow/shared` (never from `zod` directly) and always schema-qualify tables (`talent.candidates`).
* Emails are queued with `queueEmailSafe()` **after** the DB transaction commits.

Roles: `admin`, `recruiter`, `hiring_manager`, `reviewer`, `interviewer`.

Application pipeline stages (`talent.application_stage`):
`applied → screening → shortlisted → assessment → ai_interview → interview → offer → pre_joining → joined`
Status (`talent.application_status`): `active | on_hold | rejected | withdrawn | hired`.

---

## identity-service (4001) — schema `identity`

User: `{ id, email, fullName, title, role, departmentId, departmentName, isActive, lastLoginAt, createdAt, hasLoggedIn }`

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/internal/auth/resolve` | gateway | body `{ authUserId, email, name }` → `{ id, email, role, name, isActive }`. Match by `auth_user_id`, else by email (invited user → link auth id, fill name). If **no users exist** → create as `admin` (bootstrap). If email in `ADMIN_EMAILS` env (csv) → create admin. Else 403 "You have not been invited". Updates `last_login_at` (at most once / 5 min). |
| GET | `/internal/users?ids=a,b` | services | → `[{ id, email, name, role, isActive }]` (plain array) |
| GET | `/internal/users/:id` | services | → `{ id, email, name, role, isActive }` |
| GET | `/me` | any | → User |
| PATCH | `/me` | any | `{ fullName?, title? }` |
| GET | `/users?role=&q=&active=true` | any | → `{ data: User[], total }` |
| POST | `/users` | admin | `{ email, fullName, role, departmentId?, title?, sendInvite = true }` → User. Sends Supabase invite (`auth.admin.inviteUserByEmail(email, { redirectTo: APP_URL + '/login' })`); "already registered" errors are ignored. |
| PATCH | `/users/:id` | admin | `{ fullName?, role?, departmentId?, title?, isActive? }`. Admin cannot demote/deactivate themselves. |
| POST | `/users/:id/resend-invite` | admin | |
| GET | `/departments` | any | → `{ data: [{ id, name, userCount }], total }` |
| POST | `/departments` | HR | `{ name }` |
| PATCH | `/departments/:id` | HR | `{ name }` |
| DELETE | `/departments/:id` | admin | 204 |

## jobs-service (4002) — schema `jobs`

Job: `{ id, code, title, slug, departmentId, location, employmentType, workMode, experienceMin, experienceMax, salaryMin, salaryMax, currency, openings, filled, description, status, priority, hiringManagerId, recruiterId, targetDate, publishedAt, closedAt, closeReason, createdBy, createdAt, updatedAt, skills: [{ name, isRequired }], reviewerIds: string[], interviewPlan: [{ id, sequence, name, kind, durationMin, questionCount, passScore, focusAreas }] }`
List items omit `description` and `interviewPlan`.

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/jobs?status=&q=&departmentId=&page=&pageSize=` | any | `status` may be csv. Sort: open first, then priority, then newest. |
| GET | `/jobs/stats` | any | `{ total, byStatus: { draft, open, on_hold, closed, filled }, openPositions }` (`openPositions` = Σ(openings − filled) of open jobs) |
| GET | `/jobs/:id` | any | Job |
| POST | `/jobs` | HR | body = Job fields (`title` required, `status` may be `draft`/`open`), `skills?`, `reviewerIds?`, `interviewPlan?` (sequence = index+1). Default plan when omitted: `AI Screening` (ai_screening, 20 min, 6 q, pass 60), `Technical Interview` (ai_proctored, 45 min, 8 q, pass 65), `Hiring Manager Round` (human, 45 min). Slug = slugified title + 6 random chars. |
| PATCH | `/jobs/:id` | HR | partial; `skills`/`reviewerIds`/`interviewPlan` replace the whole set when provided |
| POST | `/jobs/:id/status` | HR | `{ status: 'open'|'on_hold'|'closed'|'draft', reason? }` — sets `publishedAt` on first open, `closedAt` on close |
| POST | `/jobs/:id/duplicate` | HR | → new draft Job |
| DELETE | `/jobs/:id` | admin | drafts only, 204 |
| GET | `/public/careers` | public | open jobs → `{ data: [{ id, title, slug, code, location, employmentType, workMode, experienceMin, experienceMax, publishedAt, skills: string[] }], total }` |
| GET | `/public/careers/:slug` | public | open job incl. `description` (404 if not open) |
| GET | `/internal/jobs/:id` | services | → `JobContext` (see `packages/shared/src/types.ts`) |
| GET | `/internal/jobs/by-slug/:slug` | services | → `JobContext` |
| GET | `/internal/jobs?ids=a,b` | services | → `[{ id, code, title, status }]` |
| POST | `/internal/jobs/:id/fill` | services | `filled += 1`; when `filled >= openings` → status `filled`, `closedAt = now()`; publishes `job.filled` |

## talent-service (4003) — schema `talent`

Candidate: `{ id, fullName, email, phone, location, currentTitle, currentCompany, experienceYears, linkedinUrl, portfolioUrl, summary, source, sourceDetail, noticePeriodDays, currentCtc, expectedCtc, skills: string[], createdAt, updatedAt }`

Application: `{ id, candidateId, jobId, stage, status, aiMatchScore, aiMatch: { summary, strengths[], gaps[], recommendation } | null, rejectionReason, appliedAt, stageChangedAt, updatedAt, candidate: { id, fullName, email, phone, currentTitle, currentCompany, experienceYears, location, skills }, reviewSummary: { pending, completed, positive, negative, avgRating } }`

Review: `{ id, applicationId, reviewerId, requestedBy, status, decision, rating, comments, dueAt, requestedAt, submittedAt }`

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/candidates?q=&skill=&source=&jobId=&page=&pageSize=` | any | → `{ data: (Candidate & { applicationCount })[], total }`; `q` = full-text + ilike |
| POST | `/candidates` | HR | Candidate fields + `skills?`, `jobId?` (also creates application). Duplicate email → 409 with `details: { candidateId }` |
| POST | `/candidates/upload` | HR | **multipart**: one or more `files` (pdf/docx/txt, ≤10 MB) + fields `jobId?`, `source?` (default `manual_upload`, `bulk_upload` when >1 file). Per file: extract text → AI parse → upsert candidate by email → store resume → optional application. → `{ results: [{ fileName, status: 'created'|'updated'|'failed', candidateId?, applicationId?, candidateName?, error? }] }` |
| GET | `/candidates/:id` | any | Candidate + `{ resume: { id, fileName, mimeType, sizeBytes, uploadedAt, parsed } | null, applications: Application[] }` |
| PATCH | `/candidates/:id` | HR | partial Candidate (+ `skills` replaces set) |
| DELETE | `/candidates/:id` | admin | 204 (also removes stored resumes) |
| POST | `/candidates/:id/resume` | HR | multipart single `file` → new primary resume, re-parse; fills only empty profile fields, merges skills |
| GET | `/candidates/:id/resume/url` | any | → `{ url }` (signed, 10 min) |
| GET/POST | `/candidates/:id/notes` | any / any | `{ data: [{ id, authorId, body, createdAt }] }` / body `{ body }` |
| GET | `/applications?jobId=&stage=&status=&q=&candidateId=&page=&pageSize=` | any | `pageSize` ≤ 500 (kanban). `stage`/`status` may be csv. → `{ data: Application[], total }` |
| GET | `/applications/stats?jobId=` | any | `{ total, active, byStage: {stage: n} (active only), byStatus: {status: n}, byJob: [{ jobId, total, active, byStage }], hiredThisMonth }` |
| GET | `/applications/:id` | any | Application + `{ stageHistory: [{ id, fromStage, toStage, fromStatus, toStatus, note, changedBy, changedAt }], reviews: Review[] }` |
| POST | `/applications` | HR | `{ candidateId, jobId }` → Application (AI match runs in background) |
| POST | `/applications/:id/stage` | HR | `{ stage?, status?, note?, rejectionReason?, notifyCandidate? }`; rejected + `notifyCandidate` → `rejection` email |
| POST | `/applications/bulk/stage` | HR | `{ applicationIds[], stage?, status?, note?, rejectionReason?, notifyCandidate? }` → `{ updated }` |
| POST | `/applications/:id/rematch` | HR | recompute AI match → Application |
| POST | `/reviews/request` | HR | `{ applicationIds[], reviewerIds[], dueAt? }` → creates pending reviews (skips existing), moves `applied → screening`, one email per reviewer (`review_requested`, link `APP_URL/reviews`) → `{ created }` |
| GET | `/reviews?mine=true&status=&applicationId=&jobId=&page=&pageSize=` | any | reviewers/interviewers only ever see their own → `{ data: (Review & { application: Application })[], total }` |
| POST | `/reviews/:id/submit` | owner or HR | `{ decision: 'strong_yes'|'yes'|'maybe'|'no', rating 1-5, comments? }` |
| DELETE | `/reviews/:id` | HR | cancel (status `cancelled`) |
| POST | `/public/apply/:slug` | public | **multipart**: `fullName, email, phone?, location?, linkedinUrl?, experienceYears?, noticePeriodDays?, currentCtc?, expectedCtc?, coverNote?` + `resume` file (required). Creates/updates candidate (`career_page`), application, sends `application_received`. Already applied → 409 friendly message. → `{ ok: true }` |
| GET | `/internal/applications/:id` | services | → `ApplicationContext` |
| POST | `/internal/applications/:id/stage` | services | `{ stage?, status?, note?, actorId? }` → `{ ok: true }` (records history + event; no-op if unchanged) |
| GET | `/internal/candidates/:id` | services | → Candidate |

Background: AI match after each application is created; optional **IMAP worker** (when `IMAP_HOST` set) imports resume attachments from the inbox (source `email`), matches a job code like `JOB-1001` in the subject to create an application, records `talent.inbound_emails` for dedupe.

## assessment-service (4004) — schema `assessment`

Test: `{ id, title, description, jobId, durationMin, passPercent, shuffleQuestions, proctoringEnabled, status, questionCount, totalPoints, invitationCount, createdAt, updatedAt }`; detail adds `questions: [{ id, position, type, prompt, options: string[], correctOptions: number[], points, rubric }]`.
Question types: `mcq` (response = option index), `multi_select` (number[]), `short_text`/`long_text`/`code` (string, AI graded with rubric).
Invitation: `{ id, testId, testTitle, applicationId, candidateId, jobId, candidateName, candidateEmail, status, expiresAt, startedAt, deadlineAt, submittedAt, gradedAt, score, maxScore, percent, passed, integrityScore, aiSummary, createdAt }`

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/tests?jobId=&status=` | any | `{ data: Test[], total }` |
| POST | `/tests` | HR | Test fields + `questions?` |
| GET/PATCH/DELETE | `/tests/:id` | any/HR/HR | DELETE archives if invitations exist, else deletes |
| PUT | `/tests/:id/questions` | HR | `{ questions: [...] }` replaces all (position = index+1) |
| POST | `/tests/:id/generate` | HR | `{ count 1-30, difficulty: 'easy'|'medium'|'hard', types?: QuestionType[], topics?, append = true }` → AI generated questions saved → Test detail |
| GET | `/invitations/stats` | any | `{ byStatus, passed, failed }` |
| POST | `/invitations` | HR | `{ testId, applicationIds[], expiresInDays = 3 }` → emails `assessment_invite`, moves stage → `assessment` → `{ created, skipped, errors: [{ applicationId, error }] }` |
| GET | `/invitations?testId=&applicationId=&candidateId=&status=&page=` | any | `{ data: Invitation[], total }` |
| GET | `/invitations/:id` | any | Invitation + `answers: [{ questionId, position, prompt, type, options, correctOptions, points, response, isCorrect, pointsAwarded, aiFeedback }]` + `proctoring: { counts: {type: n}, events: [{ eventType, details, occurredAt }] }` |
| POST | `/invitations/:id/cancel` · `/resend` · `/regrade` | HR | resend = new token + new expiry + email |
| GET | `/public/assessment/:token` | public | `{ status, candidateName, companyName, expiresAt, startedAt, deadlineAt, serverTime, test: { title, description, durationMin, questionCount, proctoringEnabled }, questions?: [{ id, position, type, prompt, options, points }], answers?: { [questionId]: response } }` (questions only once started; never `correctOptions`) |
| POST | `/public/assessment/:token/start` | public | idempotent; sets `startedAt`, `deadlineAt` → same payload |
| PUT | `/public/assessment/:token/answers` | public | `{ answers: [{ questionId, response }] }` autosave (rejected after deadline + 60s grace) |
| POST | `/public/assessment/:token/submit` | public | `{ answers? }` → saves, status `submitted`, grades in background (MCQ exact, text via AI), integrity score, status `graded` → `{ ok: true }` |
| POST | `/public/assessment/:token/proctor` | public | `{ events: [{ type, details?, at? }] }` types: `tab_hidden, window_blur, fullscreen_exit, copy, paste, right_click, camera_denied, camera_off, multiple_displays` |

Integrity score = `max(0, 100 − Σ weight×count)` with weights tab_hidden 8, window_blur 4, fullscreen_exit 8, paste 10, copy 3, right_click 1, camera_denied 25, camera_off 10, multiple_displays 15.
Worker: expire `invited` past `expires_at`; auto-submit `started` past `deadline_at + 2 min`.

## interview-service (4005) — schema `interview`

Round: `{ id, applicationId, candidateId, jobId, candidateName, candidateEmail, jobTitle, sequence, name, kind: 'ai_screening'|'ai_proctored'|'human', status, durationMin, questionCount, passScore, focusAreas, scheduledAt, meetingUrl, expiresAt, startedAt, completedAt, score, passed, recommendation, aiSummary, evaluation: { overallScore, recommendation, summary, strengths[], concerns[], competencies: [{ name, score, comment }] } | null, integrityScore, interviewerIds: string[], createdAt, updatedAt }`

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/rounds?applicationId=&candidateId=&status=&kind=&mine=true&upcoming=true&page=` | any | interviewers only see rounds they're assigned to |
| GET | `/rounds/stats` | any | `{ byStatus, upcoming, awaitingFeedback, completedThisWeek }` |
| POST | `/rounds/series` | HR | `{ applicationIds[] }` → creates all rounds from the job's `interviewPlan`, invites round 1 (AI → email link; human → stays `pending` for scheduling), stage → `ai_interview` (AI first) or `interview` → `{ created, skipped, errors }` |
| POST | `/rounds` | HR | ad-hoc round `{ applicationId, name, kind, durationMin, questionCount?, passScore?, focusAreas? }` (sequence = max+1) |
| GET | `/rounds/:id` | any | Round + `messages: [{ seq, role, content, createdAt }]`, `feedback: [{ id, interviewerId, rating, recommendation, strengths, concerns, comments, submittedAt }]`, `proctoring: { counts, events }` |
| POST | `/rounds/:id/invite` | HR | AI rounds: new token (5 days), status `invited`, `ai_interview_invite` email |
| POST | `/rounds/:id/schedule` | HR | human rounds `{ scheduledAt, durationMin?, meetingUrl, interviewerIds[] }` → status `scheduled`, `interview_scheduled` email with .ics to candidate, `interviewer_assigned` to panel |
| POST | `/rounds/:id/feedback` | assigned interviewer or HR | `{ rating 1-5, recommendation, strengths?, concerns?, comments? }`; when all panelists submitted → `evaluated`, `score = avg(rating)×20`, `passed = score ≥ passScore` → advance |
| POST | `/rounds/:id/decision` | HR | `{ passed: boolean, note? }` manual override → advance when passed |
| POST | `/rounds/:id/cancel` | HR | |
| GET | `/public/interview/:token` | public | `{ status, candidateName, jobTitle, roundName, kind, durationMin, questionCount, proctored, companyName, startedAt, deadlineAt, serverTime, messages }` |
| POST | `/public/interview/:token/start` | public | idempotent → status `in_progress`, AI asks Q1 → `{ messages, done }` |
| POST | `/public/interview/:token/answer` | public | `{ content }` → AI follow-up / next question; after `questionCount` answers or time over → `completed`, background evaluation → `evaluated` → `{ messages, done }` |
| POST | `/public/interview/:token/proctor` | public | same as assessment |

**Advance**: when a round is evaluated & passed → next `pending` round: AI kind → auto-invite; human → stays `pending` (HR schedules) and stage → `interview`. Last round passed → event `interview.series_passed`. Failed → event `interview.round_failed` (HR decides).
Worker: expire `invited` past `expires_at`; complete + evaluate `in_progress` past `startedAt + 2×duration`.

## offer-service (4006) — schema `offer`

Offer: `{ id, applicationId, candidateId, jobId, candidateName, candidateEmail, jobTitle, status, currentVersion, expiresAt, sentAt, respondedAt, declineReason, createdAt, updatedAt, current: OfferVersion }`
OfferVersion: `{ id, version, designation, baseSalary, variablePay, joiningBonus, equity, currency, joiningDate, location, benefits, additionalTerms, createdAt }`

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/offers?status=&jobId=&applicationId=&candidateId=&page=` | any | |
| GET | `/offers/stats` | any | `{ byStatus, acceptanceRate }` |
| POST | `/offers` | HR | `{ applicationId, designation, baseSalary, variablePay?, joiningBonus?, equity?, currency?, joiningDate?, location?, benefits?, additionalTerms? }` → draft v1 |
| GET | `/offers/:id` | any | Offer + `versions[]` + `messages: [{ id, actor, authorId, message, requestedBaseSalary, requestedJoiningDate, offerVersion, createdAt }]` |
| PATCH | `/offers/:id` | HR | drafts only: edits current version |
| POST | `/offers/:id/send` | HR | `{ expiresInDays = 7 }` → token, `sent`, `offer_sent` email, stage → `offer` |
| POST | `/offers/:id/revise` | HR | version fields + `message?` → new version; if already sent → status `sent`, `offer_revised` email (same link) |
| POST | `/offers/:id/messages` | HR | `{ message }` recruiter note to candidate (emailed with `generic`) |
| POST | `/offers/:id/withdraw` | HR | `{ reason? }` |
| POST | `/offers/:id/mark-accepted` | HR | offline acceptance (same effects as candidate accept) |
| GET | `/public/offer/:token` | public | `{ status, candidateName, jobTitle, companyName, expiresAt, current, messages }` |
| POST | `/public/offer/:token/accept` | public | `{ joiningDate? }` → `accepted`, stage → `pre_joining`, creates onboarding case (`POST onboarding /internal/cases`), emails recruiter |
| POST | `/public/offer/:token/decline` | public | `{ reason }` |
| POST | `/public/offer/:token/counter` | public | `{ message, requestedBaseSalary?, requestedJoiningDate? }` → `negotiating`, emails recruiter |

Worker: `sent`/`negotiating` past `expires_at` → `expired`.

## onboarding-service (4007) — schema `onboarding`

Case: `{ id, applicationId, candidateId, jobId, offerId, candidateName, candidateEmail, jobTitle, joiningDate, status, joinedAt, droppedReason, createdAt, updatedAt, documentStats: { total, uploaded, verified, rejected, requiredPending } }`

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/internal/cases` | offer-service | `{ applicationId, candidateId, jobId, offerId, candidateName, candidateEmail, jobTitle, joiningDate? }` idempotent by applicationId; creates a document row per active type, token (30 days), `onboarding_invite` email → Case |
| GET | `/onboarding?status=&page=` | any | |
| GET | `/onboarding/stats` | any | `{ byStatus, joiningNext30Days }` |
| GET | `/onboarding/:id` | any | Case + `documents: [{ id, documentTypeId, code, name, description, isRequired, status, fileName, mimeType, sizeBytes, uploadedAt, reviewNote, reviewedAt }]` + `bgvRequests: [{ id, vendorId, vendorName, status, referenceNo, sentAt, completedAt, resultSummary }]` |
| PATCH | `/onboarding/:id` | HR | `{ joiningDate }` |
| GET | `/onboarding/:id/documents/:docId/url` | any | `{ url }` |
| POST | `/onboarding/:id/documents/:docId/review` | HR | `{ status: 'verified'|'rejected', note? }`; rejected → `document_rejected` email |
| POST | `/onboarding/:id/resend-invite` | HR | new token + email |
| POST | `/onboarding/:id/bgv` | HR | `{ vendorId, referenceNo? }` → 7-day signed links to uploaded docs, `bgv_request` email to vendor, status `bgv_in_progress` |
| PATCH | `/onboarding/:id/bgv/:requestId` | HR | `{ status: 'in_progress'|'cleared'|'flagged'|'cancelled', resultSummary? }` → case `bgv_cleared` / `bgv_flagged` |
| POST | `/onboarding/:id/join` | HR | `{ joinedAt? }` → `joined`; talent stage `joined` + status `hired`; jobs `/internal/jobs/:id/fill` (closes the position when all openings are filled) |
| POST | `/onboarding/:id/drop` | HR | `{ reason }` → `dropped`; talent status `withdrawn` |
| GET/POST | `/bgv-vendors` · PATCH `/bgv-vendors/:id` | any/HR | `{ name, contactName?, contactEmail, isActive? }` |
| GET/POST | `/document-types` · PATCH `/document-types/:id` | any/HR | `{ code, name, description?, isRequired, sortOrder, isActive }` |
| GET | `/public/onboarding/:token` | public | `{ candidateName, jobTitle, joiningDate, companyName, status, documents: [{ id, name, description, isRequired, status, fileName, reviewNote }] }` |
| POST | `/public/onboarding/:token/documents/:docId` | public | multipart `file` (pdf/jpg/png/webp/doc/docx ≤10 MB) → `uploaded`; all required uploaded → case `documents_submitted` |

## ai-service (4008) — stateless, Groq

All AI calls use Groq chat completions in JSON mode with retry/backoff on 429/5xx. Missing `GROQ_API_KEY` → 503 `AI_NOT_CONFIGURED` (callers degrade gracefully).

| Method | Path | Notes |
|---|---|---|
| POST | `/internal/resume/parse` | `{ text }` → `{ fullName, email, phone, location, currentTitle, currentCompany, experienceYears, linkedinUrl, portfolioUrl, summary, skills[], education: [{ degree, institution, year }], experience: [{ title, company, start, end, highlights[] }] }` |
| POST | `/internal/resume/match` | `{ resumeText, job: { title, description, skills[], experienceMin?, experienceMax? } }` → `{ score 0-100, summary, strengths[], gaps[], recommendation: 'strong_fit'|'good_fit'|'partial_fit'|'poor_fit' }` |
| POST | `/internal/assessment/generate` | `{ jobTitle?, jobDescription?, skills?, count, difficulty, types[], topics? }` → `{ questions: [{ type, prompt, options[], correctOptions[], points, rubric }] }` |
| POST | `/internal/assessment/grade` | `{ items: [{ id, type, prompt, rubric, response, points }] }` → `{ results: [{ id, pointsAwarded, feedback }] }` |
| POST | `/internal/interview/next` | `{ candidateName, jobTitle, jobContext, roundName, kind, focusAreas, questionCount, transcript: [{ role, content }] }` → `{ message, done }` |
| POST | `/internal/interview/evaluate` | `{ jobTitle, jobContext, roundName, focusAreas, transcript }` → `{ overallScore, recommendation, summary, strengths[], concerns[], competencies: [{ name, score, comment }] }` |
| POST | `/ai/job-description` | HR · `{ title, department?, location?, experienceMin?, experienceMax?, skills?, notes? }` → `{ description (markdown), skills: [{ name, isRequired }] }` |
| POST | `/ai/email-draft` | HR · `{ purpose, candidateName?, jobTitle?, tone?, notes? }` → `{ subject, bodyHtml }` |
| GET | `/ai/status` | any · `{ configured, model }` |

## notification-service (4009) — schemas `notify` + reads `platform.events`

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/internal/emails` | services | `{ templateKey, to, cc?, data, relatedType?, relatedId?, candidateId?, attachments?, createdBy? }` → renders template (`{{var}}` escaped, `{{{var}}}` raw; globals `companyName`, `appUrl`), wraps branded layout, inserts `queued` → `{ id }` |
| GET | `/emails?candidateId=&status=&q=&page=` | any | `{ data: [{ id, toEmail, cc, subject, templateKey, status, attempts, lastError, relatedType, relatedId, candidateId, createdAt, sentAt }], total }` |
| GET | `/emails/:id` | any | + `bodyHtml` |
| POST | `/emails` | HR | compose `{ to, cc?, subject, bodyHtml, candidateId? }` (template `generic`) |
| POST | `/emails/:id/retry` | HR | failed → queued |
| GET | `/templates` · GET `/templates/:key` | any | `{ data: [{ id, key, name, description, subject, bodyHtml, updatedAt }] }` |
| PUT | `/templates/:key` | HR | `{ subject, bodyHtml, name? }` |
| POST | `/templates/:key/preview` | any | `{ data? }` → `{ subject, html }` (sample data filled in) |
| GET | `/activity?candidateId=&jobId=&applicationId=&limit=50&before=` | any | `{ data: [{ id, type, aggregateType, aggregateId, candidateId, jobId, applicationId, actorId, payload, createdAt }] }` newest first, cursor = `before` (event id) |

Worker (every 5 s): claims queued emails with `for update skip locked`, sends via SMTP (nodemailer), retries with exponential backoff (max 5 attempts) → `failed`. `EMAIL_DRY_RUN=true` logs instead of sending.

## Event types
`job.created, job.updated, job.status_changed, job.filled, candidate.created, candidate.updated, resume.uploaded, application.created, application.stage_changed, application.ai_matched, review.requested, review.submitted, assessment.invited, assessment.started, assessment.submitted, assessment.graded, interview.series_created, interview.invited, interview.scheduled, interview.started, interview.completed, interview.evaluated, interview.feedback_submitted, interview.series_passed, interview.round_failed, offer.created, offer.sent, offer.revised, offer.countered, offer.accepted, offer.declined, offer.withdrawn, onboarding.created, onboarding.document_uploaded, onboarding.document_reviewed, onboarding.bgv_sent, onboarding.bgv_updated, onboarding.joined, onboarding.dropped`
