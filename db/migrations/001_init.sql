-- =====================================================================
-- HireFlow - initial schema
-- Each microservice owns exactly one Postgres schema. Cross-service
-- references are plain UUIDs (no cross-schema FKs) so services stay
-- independently deployable. Within a schema, integrity is enforced with
-- FKs, CHECKs, enums and partial unique indexes.
-- =====================================================================

create schema if not exists platform;    -- shared event log (append-only)
create schema if not exists identity;    -- identity-service
create schema if not exists jobs;        -- jobs-service
create schema if not exists talent;      -- talent-service
create schema if not exists assessment;  -- assessment-service
create schema if not exists interview;   -- interview-service
create schema if not exists offer;       -- offer-service
create schema if not exists onboarding;  -- onboarding-service
create schema if not exists notify;      -- notification-service

create or replace function platform.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- platform: domain event log (audit trail + activity timeline)
-- ---------------------------------------------------------------------
create table platform.events (
  id             bigint generated always as identity primary key,
  type           text        not null,
  aggregate_type text        not null,
  aggregate_id   uuid        not null,
  candidate_id   uuid,
  job_id         uuid,
  application_id uuid,
  actor_id       uuid,
  payload        jsonb       not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index events_created_idx     on platform.events (created_at desc);
create index events_candidate_idx   on platform.events (candidate_id, created_at desc) where candidate_id is not null;
create index events_job_idx         on platform.events (job_id, created_at desc) where job_id is not null;
create index events_application_idx on platform.events (application_id, created_at desc) where application_id is not null;

-- ---------------------------------------------------------------------
-- identity
-- ---------------------------------------------------------------------
create type identity.user_role as enum ('admin', 'recruiter', 'hiring_manager', 'reviewer', 'interviewer');

create table identity.departments (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);
create unique index departments_name_key on identity.departments (lower(name));

create table identity.users (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique,
  email         text not null check (email = lower(email) and position('@' in email) > 1),
  full_name     text not null default '',
  title         text,
  role          identity.user_role not null default 'recruiter',
  department_id uuid references identity.departments (id) on delete set null,
  is_active     boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index users_email_key on identity.users (email);
create index users_role_idx on identity.users (role) where is_active;
create trigger users_updated before update on identity.users
  for each row execute function platform.set_updated_at();

-- ---------------------------------------------------------------------
-- jobs
-- ---------------------------------------------------------------------
create type jobs.job_status      as enum ('draft', 'open', 'on_hold', 'closed', 'filled');
create type jobs.employment_type as enum ('full_time', 'part_time', 'contract', 'internship');
create type jobs.work_mode       as enum ('onsite', 'remote', 'hybrid');
create type jobs.priority        as enum ('low', 'medium', 'high', 'urgent');
create type jobs.round_kind      as enum ('ai_screening', 'ai_proctored', 'human');

create sequence jobs.job_code_seq start 1001;

create table jobs.jobs (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique default ('JOB-' || nextval('jobs.job_code_seq')),
  title             text not null check (length(trim(title)) > 0),
  slug              text not null unique,
  department_id     uuid,
  location          text,
  employment_type   jobs.employment_type not null default 'full_time',
  work_mode         jobs.work_mode not null default 'onsite',
  experience_min    numeric(4,1) check (experience_min >= 0),
  experience_max    numeric(4,1) check (experience_max >= 0),
  salary_min        numeric(14,2) check (salary_min >= 0),
  salary_max        numeric(14,2) check (salary_max >= 0),
  currency          char(3) not null default 'INR',
  openings          integer not null default 1 check (openings > 0),
  filled            integer not null default 0 check (filled >= 0),
  description       text not null default '',
  status            jobs.job_status not null default 'draft',
  priority          jobs.priority not null default 'medium',
  hiring_manager_id uuid,
  recruiter_id      uuid,
  target_date       date,
  published_at      timestamptz,
  closed_at         timestamptz,
  close_reason      text,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint jobs_experience_range check (experience_max is null or experience_min is null or experience_max >= experience_min),
  constraint jobs_salary_range     check (salary_max is null or salary_min is null or salary_max >= salary_min)
);
create index jobs_status_idx on jobs.jobs (status);
create index jobs_department_idx on jobs.jobs (department_id);
create trigger jobs_updated before update on jobs.jobs
  for each row execute function platform.set_updated_at();

create table jobs.job_skills (
  job_id      uuid not null references jobs.jobs (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  is_required boolean not null default true
);
create unique index job_skills_key on jobs.job_skills (job_id, lower(name));

create table jobs.job_reviewers (
  job_id  uuid not null references jobs.jobs (id) on delete cascade,
  user_id uuid not null,
  primary key (job_id, user_id)
);

-- Interview plan template per job: the series of rounds every shortlisted candidate goes through
create table jobs.interview_plan_rounds (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references jobs.jobs (id) on delete cascade,
  sequence       smallint not null check (sequence > 0),
  name           text not null,
  kind           jobs.round_kind not null,
  duration_min   smallint not null default 30 check (duration_min between 5 and 240),
  question_count smallint not null default 6 check (question_count between 1 and 30),
  pass_score     smallint not null default 60 check (pass_score between 0 and 100),
  focus_areas    text,
  created_at     timestamptz not null default now(),
  constraint interview_plan_seq_key unique (job_id, sequence) deferrable initially deferred
);

-- ---------------------------------------------------------------------
-- talent (candidates, resumes, applications, reviews)
-- ---------------------------------------------------------------------
create type talent.candidate_source   as enum ('career_page', 'manual_upload', 'bulk_upload', 'email', 'referral', 'linkedin', 'job_board', 'agency', 'other');
create type talent.application_stage  as enum ('applied', 'screening', 'shortlisted', 'assessment', 'ai_interview', 'interview', 'offer', 'pre_joining', 'joined');
create type talent.application_status as enum ('active', 'on_hold', 'rejected', 'withdrawn', 'hired');
create type talent.review_decision    as enum ('strong_yes', 'yes', 'maybe', 'no');
create type talent.review_status      as enum ('pending', 'completed', 'cancelled');

create table talent.candidates (
  id                 uuid primary key default gen_random_uuid(),
  full_name          text not null check (length(trim(full_name)) > 0),
  email              text not null check (email = lower(email) and position('@' in email) > 1),
  phone              text,
  location           text,
  current_title      text,
  current_company    text,
  experience_years   numeric(4,1) check (experience_years >= 0),
  linkedin_url       text,
  portfolio_url      text,
  summary            text,
  source             talent.candidate_source not null default 'manual_upload',
  source_detail      text,
  notice_period_days smallint check (notice_period_days >= 0),
  current_ctc        numeric(14,2) check (current_ctc >= 0),
  expected_ctc       numeric(14,2) check (expected_ctc >= 0),
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  search             tsvector generated always as (
    to_tsvector('simple',
      coalesce(full_name, '') || ' ' || coalesce(email, '') || ' ' || coalesce(current_title, '') || ' ' ||
      coalesce(current_company, '') || ' ' || coalesce(location, ''))
  ) stored
);
create unique index candidates_email_key on talent.candidates (email);
create index candidates_search_idx on talent.candidates using gin (search);
create index candidates_created_idx on talent.candidates (created_at desc);
create trigger candidates_updated before update on talent.candidates
  for each row execute function platform.set_updated_at();

create table talent.candidate_skills (
  candidate_id uuid not null references talent.candidates (id) on delete cascade,
  name         text not null check (length(trim(name)) > 0)
);
create unique index candidate_skills_key on talent.candidate_skills (candidate_id, lower(name));
create index candidate_skills_name_idx on talent.candidate_skills (lower(name));

create table talent.resumes (
  id           uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references talent.candidates (id) on delete cascade,
  storage_path text not null,
  file_name    text not null,
  mime_type    text not null,
  size_bytes   integer not null check (size_bytes > 0),
  text_content text,
  parsed       jsonb,
  is_primary   boolean not null default true,
  uploaded_by  uuid,
  uploaded_at  timestamptz not null default now()
);
create unique index resumes_one_primary on talent.resumes (candidate_id) where is_primary;
create index resumes_candidate_idx on talent.resumes (candidate_id);

create table talent.applications (
  id               uuid primary key default gen_random_uuid(),
  candidate_id     uuid not null references talent.candidates (id) on delete cascade,
  job_id           uuid not null,
  stage            talent.application_stage  not null default 'applied',
  status           talent.application_status not null default 'active',
  ai_match_score   smallint check (ai_match_score between 0 and 100),
  ai_match         jsonb,
  rejection_reason text,
  applied_at       timestamptz not null default now(),
  stage_changed_at timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  constraint applications_candidate_job_key unique (candidate_id, job_id)
);
create index applications_job_stage_idx on talent.applications (job_id, stage);
create index applications_status_idx on talent.applications (status);
create trigger applications_updated before update on talent.applications
  for each row execute function platform.set_updated_at();

create table talent.stage_history (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references talent.applications (id) on delete cascade,
  from_stage     talent.application_stage,
  to_stage       talent.application_stage not null,
  from_status    talent.application_status,
  to_status      talent.application_status not null,
  note           text,
  changed_by     uuid,
  changed_at     timestamptz not null default now()
);
create index stage_history_application_idx on talent.stage_history (application_id, changed_at desc);

create table talent.reviews (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references talent.applications (id) on delete cascade,
  reviewer_id    uuid not null,
  requested_by   uuid,
  status         talent.review_status not null default 'pending',
  decision       talent.review_decision,
  rating         smallint check (rating between 1 and 5),
  comments       text,
  due_at         timestamptz,
  requested_at   timestamptz not null default now(),
  submitted_at   timestamptz,
  constraint reviews_application_reviewer_key unique (application_id, reviewer_id),
  constraint reviews_completed_has_decision check (status <> 'completed' or decision is not null)
);
create index reviews_reviewer_status_idx on talent.reviews (reviewer_id, status);

create table talent.notes (
  id           uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references talent.candidates (id) on delete cascade,
  author_id    uuid,
  body         text not null check (length(trim(body)) > 0),
  created_at   timestamptz not null default now()
);
create index notes_candidate_idx on talent.notes (candidate_id, created_at desc);

-- Dedupe ledger for resumes imported from the IMAP inbox
create table talent.inbound_emails (
  id           uuid primary key default gen_random_uuid(),
  message_id   text not null unique,
  from_email   text,
  subject      text,
  received_at  timestamptz,
  candidate_id uuid references talent.candidates (id) on delete set null,
  status       text not null check (status in ('processed', 'skipped', 'failed')),
  error        text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- assessment
-- ---------------------------------------------------------------------
create type assessment.test_status       as enum ('draft', 'active', 'archived');
create type assessment.question_type     as enum ('mcq', 'multi_select', 'short_text', 'long_text', 'code');
create type assessment.invitation_status as enum ('invited', 'started', 'submitted', 'graded', 'expired', 'cancelled');

create table assessment.tests (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null check (length(trim(title)) > 0),
  description        text,
  job_id             uuid,
  duration_min       smallint not null default 45 check (duration_min between 5 and 300),
  pass_percent       smallint not null default 60 check (pass_percent between 0 and 100),
  shuffle_questions  boolean not null default false,
  proctoring_enabled boolean not null default true,
  status             assessment.test_status not null default 'draft',
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index tests_job_idx on assessment.tests (job_id);
create trigger tests_updated before update on assessment.tests
  for each row execute function platform.set_updated_at();

create table assessment.questions (
  id              uuid primary key default gen_random_uuid(),
  test_id         uuid not null references assessment.tests (id) on delete cascade,
  position        smallint not null check (position > 0),
  type            assessment.question_type not null,
  prompt          text not null check (length(trim(prompt)) > 0),
  options         jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  correct_options jsonb not null default '[]'::jsonb check (jsonb_typeof(correct_options) = 'array'),
  points          smallint not null default 1 check (points > 0),
  rubric          text,
  created_at      timestamptz not null default now(),
  constraint questions_position_key unique (test_id, position) deferrable initially deferred
);

create table assessment.invitations (
  id              uuid primary key default gen_random_uuid(),
  test_id         uuid not null references assessment.tests (id) on delete restrict,
  application_id  uuid not null,
  candidate_id    uuid not null,
  job_id          uuid,
  candidate_name  text not null,
  candidate_email text not null,
  token_hash      text not null unique,
  status          assessment.invitation_status not null default 'invited',
  expires_at      timestamptz not null,
  started_at      timestamptz,
  deadline_at     timestamptz,
  submitted_at    timestamptz,
  graded_at       timestamptz,
  score           numeric(8,2),
  max_score       numeric(8,2),
  percent         numeric(5,2) check (percent between 0 and 100),
  passed          boolean,
  integrity_score smallint check (integrity_score between 0 and 100),
  ai_summary      text,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create unique index invitations_one_active on assessment.invitations (test_id, application_id)
  where status in ('invited', 'started');
create index invitations_application_idx on assessment.invitations (application_id);
create index invitations_status_idx on assessment.invitations (status);

create table assessment.answers (
  id             uuid primary key default gen_random_uuid(),
  invitation_id  uuid not null references assessment.invitations (id) on delete cascade,
  question_id    uuid not null references assessment.questions (id) on delete cascade,
  response       jsonb not null,
  is_correct     boolean,
  points_awarded numeric(8,2),
  ai_feedback    text,
  answered_at    timestamptz not null default now(),
  constraint answers_invitation_question_key unique (invitation_id, question_id)
);

create table assessment.proctor_events (
  id            bigint generated always as identity primary key,
  invitation_id uuid not null references assessment.invitations (id) on delete cascade,
  event_type    text not null,
  details       jsonb not null default '{}'::jsonb,
  occurred_at   timestamptz not null default now()
);
create index assessment_proctor_invitation_idx on assessment.proctor_events (invitation_id);

-- ---------------------------------------------------------------------
-- interview
-- ---------------------------------------------------------------------
create type interview.round_kind     as enum ('ai_screening', 'ai_proctored', 'human');
create type interview.round_status   as enum ('pending', 'invited', 'scheduled', 'in_progress', 'completed', 'evaluated', 'cancelled', 'expired', 'no_show');
create type interview.recommendation as enum ('strong_hire', 'hire', 'lean_hire', 'lean_no_hire', 'no_hire');
create type interview.message_role   as enum ('interviewer', 'candidate');

create table interview.rounds (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null,
  candidate_id    uuid not null,
  job_id          uuid not null,
  candidate_name  text not null,
  candidate_email text not null,
  job_title       text not null,
  job_context     text,
  sequence        smallint not null check (sequence > 0),
  name            text not null,
  kind            interview.round_kind not null,
  status          interview.round_status not null default 'pending',
  duration_min    smallint not null default 30 check (duration_min between 5 and 240),
  question_count  smallint not null default 6 check (question_count between 1 and 30),
  pass_score      smallint not null default 60 check (pass_score between 0 and 100),
  focus_areas     text,
  scheduled_at    timestamptz,
  meeting_url     text,
  token_hash      text unique,
  expires_at      timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  score           smallint check (score between 0 and 100),
  passed          boolean,
  recommendation  interview.recommendation,
  ai_summary      text,
  evaluation      jsonb,
  integrity_score smallint check (integrity_score between 0 and 100),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index rounds_application_sequence_key on interview.rounds (application_id, sequence) where status <> 'cancelled';
create index rounds_status_idx on interview.rounds (status);
create index rounds_scheduled_idx on interview.rounds (scheduled_at) where scheduled_at is not null;
create index rounds_candidate_idx on interview.rounds (candidate_id);
create trigger rounds_updated before update on interview.rounds
  for each row execute function platform.set_updated_at();

create table interview.round_interviewers (
  round_id uuid not null references interview.rounds (id) on delete cascade,
  user_id  uuid not null,
  primary key (round_id, user_id)
);
create index round_interviewers_user_idx on interview.round_interviewers (user_id);

create table interview.messages (
  id         bigint generated always as identity primary key,
  round_id   uuid not null references interview.rounds (id) on delete cascade,
  seq        integer not null check (seq > 0),
  role       interview.message_role not null,
  content    text not null,
  created_at timestamptz not null default now(),
  constraint messages_round_seq_key unique (round_id, seq)
);

create table interview.feedback (
  id             uuid primary key default gen_random_uuid(),
  round_id       uuid not null references interview.rounds (id) on delete cascade,
  interviewer_id uuid not null,
  rating         smallint not null check (rating between 1 and 5),
  recommendation interview.recommendation not null,
  strengths      text,
  concerns       text,
  comments       text,
  submitted_at   timestamptz not null default now(),
  constraint feedback_round_interviewer_key unique (round_id, interviewer_id)
);

create table interview.proctor_events (
  id          bigint generated always as identity primary key,
  round_id    uuid not null references interview.rounds (id) on delete cascade,
  event_type  text not null,
  details     jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index interview_proctor_round_idx on interview.proctor_events (round_id);

-- ---------------------------------------------------------------------
-- offer
-- ---------------------------------------------------------------------
create type offer.offer_status      as enum ('draft', 'sent', 'negotiating', 'accepted', 'declined', 'withdrawn', 'expired');
create type offer.negotiation_actor as enum ('candidate', 'recruiter');

create table offer.offers (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null,
  candidate_id    uuid not null,
  job_id          uuid not null,
  candidate_name  text not null,
  candidate_email text not null,
  job_title       text not null,
  status          offer.offer_status not null default 'draft',
  current_version smallint not null default 1 check (current_version > 0),
  token_hash      text unique,
  expires_at      timestamptz,
  sent_at         timestamptz,
  responded_at    timestamptz,
  decline_reason  text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index offers_one_open_per_application on offer.offers (application_id)
  where status not in ('declined', 'withdrawn', 'expired');
create index offers_status_idx on offer.offers (status);
create trigger offers_updated before update on offer.offers
  for each row execute function platform.set_updated_at();

create table offer.offer_versions (
  id               uuid primary key default gen_random_uuid(),
  offer_id         uuid not null references offer.offers (id) on delete cascade,
  version          smallint not null check (version > 0),
  designation      text not null,
  base_salary      numeric(14,2) not null check (base_salary >= 0),
  variable_pay     numeric(14,2) not null default 0 check (variable_pay >= 0),
  joining_bonus    numeric(14,2) not null default 0 check (joining_bonus >= 0),
  equity           text,
  currency         char(3) not null default 'INR',
  joining_date     date,
  location         text,
  benefits         text,
  additional_terms text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  constraint offer_versions_key unique (offer_id, version)
);

create table offer.negotiation_messages (
  id                     uuid primary key default gen_random_uuid(),
  offer_id               uuid not null references offer.offers (id) on delete cascade,
  actor                  offer.negotiation_actor not null,
  author_id              uuid,
  message                text not null,
  requested_base_salary  numeric(14,2) check (requested_base_salary >= 0),
  requested_joining_date date,
  offer_version          smallint,
  created_at             timestamptz not null default now()
);
create index negotiation_offer_idx on offer.negotiation_messages (offer_id, created_at);

-- ---------------------------------------------------------------------
-- onboarding (pre-joining documents + background verification)
-- ---------------------------------------------------------------------
create type onboarding.case_status     as enum ('collecting_documents', 'documents_submitted', 'bgv_in_progress', 'bgv_cleared', 'bgv_flagged', 'joined', 'dropped');
create type onboarding.document_status as enum ('pending', 'uploaded', 'verified', 'rejected');
create type onboarding.bgv_status      as enum ('sent', 'in_progress', 'cleared', 'flagged', 'cancelled');

create table onboarding.document_types (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  description text,
  is_required boolean not null default true,
  sort_order  smallint not null default 0,
  is_active   boolean not null default true
);

create table onboarding.cases (
  id               uuid primary key default gen_random_uuid(),
  application_id   uuid not null unique,
  candidate_id     uuid not null,
  job_id           uuid not null,
  offer_id         uuid,
  candidate_name   text not null,
  candidate_email  text not null,
  job_title        text not null,
  joining_date     date,
  status           onboarding.case_status not null default 'collecting_documents',
  token_hash       text unique,
  token_expires_at timestamptz,
  joined_at        timestamptz,
  dropped_reason   text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index cases_status_idx on onboarding.cases (status);
create trigger cases_updated before update on onboarding.cases
  for each row execute function platform.set_updated_at();

create table onboarding.case_documents (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid not null references onboarding.cases (id) on delete cascade,
  document_type_id uuid not null references onboarding.document_types (id) on delete restrict,
  status           onboarding.document_status not null default 'pending',
  storage_path     text,
  file_name        text,
  mime_type        text,
  size_bytes       integer,
  uploaded_at      timestamptz,
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  review_note      text,
  constraint case_documents_key unique (case_id, document_type_id),
  constraint case_documents_file_present check (status = 'pending' or storage_path is not null)
);

create table onboarding.bgv_vendors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  contact_name  text,
  contact_email text not null check (contact_email = lower(contact_email)),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table onboarding.bgv_requests (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references onboarding.cases (id) on delete cascade,
  vendor_id      uuid not null references onboarding.bgv_vendors (id) on delete restrict,
  status         onboarding.bgv_status not null default 'sent',
  reference_no   text,
  sent_at        timestamptz not null default now(),
  completed_at   timestamptz,
  result_summary text,
  created_by     uuid,
  updated_at     timestamptz not null default now()
);
create index bgv_requests_case_idx on onboarding.bgv_requests (case_id);
create trigger bgv_requests_updated before update on onboarding.bgv_requests
  for each row execute function platform.set_updated_at();

insert into onboarding.document_types (code, name, description, is_required, sort_order) values
  ('photo',             'Passport-size photograph',        'Recent colour photograph',                         true,  1),
  ('id_proof',          'Government ID proof',             'Aadhaar / Passport / Driving licence',             true,  2),
  ('pan',               'PAN card',                        'Permanent Account Number card',                    true,  3),
  ('address_proof',     'Address proof',                   'Utility bill / rental agreement / passport',       true,  4),
  ('education',         'Highest education certificate',  'Degree certificate and final marksheet',           true,  5),
  ('experience_letter', 'Experience / relieving letters', 'From previous employers',                          false, 6),
  ('payslips',          'Last 3 months payslips',          'From current / last employer',                     false, 7),
  ('signed_offer',      'Signed offer letter',             'Scanned copy of the signed offer letter',          true,  8);

-- ---------------------------------------------------------------------
-- notify (email templates + transactional outbox)
-- ---------------------------------------------------------------------
create type notify.email_status as enum ('queued', 'sending', 'sent', 'failed');

create table notify.templates (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  name        text not null,
  description text,
  subject     text not null,
  body_html   text not null,
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);
create trigger templates_updated before update on notify.templates
  for each row execute function platform.set_updated_at();

create table notify.emails (
  id              uuid primary key default gen_random_uuid(),
  to_email        text not null,
  cc              text[] not null default '{}',
  subject         text not null,
  body_html       text not null,
  template_key    text,
  status          notify.email_status not null default 'queued',
  attempts        smallint not null default 0,
  last_error      text,
  related_type    text,
  related_id      uuid,
  candidate_id    uuid,
  attachments     jsonb not null default '[]'::jsonb,
  next_attempt_at timestamptz not null default now(),
  sent_at         timestamptz,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create index emails_queue_idx on notify.emails (next_attempt_at) where status = 'queued';
create index emails_candidate_idx on notify.emails (candidate_id, created_at desc) where candidate_id is not null;
create index emails_created_idx on notify.emails (created_at desc);

insert into notify.templates (key, name, description, subject, body_html) values
('application_received', 'Application received', 'Sent to a candidate after they apply',
 'We received your application for {{jobTitle}}',
 '<p>Hi {{candidateName}},</p><p>Thank you for applying for the <strong>{{jobTitle}}</strong> role at {{companyName}}. Our team is reviewing your profile and will get back to you soon.</p><p>Best regards,<br/>{{companyName}} Talent Team</p>'),
('review_requested', 'Resume review requested', 'Sent to a reviewer when resumes are assigned to them',
 '{{count}} resume(s) waiting for your review - {{jobTitle}}',
 '<p>Hi {{reviewerName}},</p><p>{{count}} candidate(s) for <strong>{{jobTitle}}</strong> are waiting for your review.</p><p><a class="btn" href="{{link}}">Open review queue</a></p>'),
('assessment_invite', 'Assessment invitation', 'Online test invitation sent to a candidate',
 'Online assessment for {{jobTitle}} at {{companyName}}',
 '<p>Hi {{candidateName}},</p><p>Congratulations! You have been shortlisted for the <strong>{{jobTitle}}</strong> role. The next step is an online assessment: <strong>{{testTitle}}</strong> ({{durationMin}} minutes).</p><p>The test is proctored: please use a laptop with a webcam, stay in full-screen and do not switch tabs.</p><p><a class="btn" href="{{link}}">Start assessment</a></p><p>This link expires on {{expiresAt}}.</p>'),
('ai_interview_invite', 'AI interview invitation', 'Invitation to an AI-conducted interview round',
 'Interview invitation: {{roundName}} - {{jobTitle}}',
 '<p>Hi {{candidateName}},</p><p>You are invited to the <strong>{{roundName}}</strong> round for the <strong>{{jobTitle}}</strong> role. This round is conducted by our AI interviewer and takes about {{durationMin}} minutes. You can take it at any time before the link expires.</p><p>{{proctoringNote}}</p><p><a class="btn" href="{{link}}">Start interview</a></p><p>This link expires on {{expiresAt}}.</p>'),
('interview_scheduled', 'Interview scheduled', 'Sent to a candidate when a live interview is scheduled',
 'Interview scheduled: {{roundName}} - {{jobTitle}}',
 '<p>Hi {{candidateName}},</p><p>Your <strong>{{roundName}}</strong> interview for the <strong>{{jobTitle}}</strong> role is scheduled for <strong>{{scheduledAt}}</strong> ({{durationMin}} minutes).</p><p><a class="btn" href="{{meetingUrl}}">Join meeting</a></p><p>A calendar invite is attached.</p>'),
('interviewer_assigned', 'Interviewer assigned', 'Sent to interviewers when they are assigned to a round',
 'You are interviewing {{candidateName}} - {{roundName}}',
 '<p>Hi {{interviewerName}},</p><p>You are on the panel for <strong>{{candidateName}}</strong> ({{jobTitle}}) - <strong>{{roundName}}</strong> on <strong>{{scheduledAt}}</strong>.</p><p><a class="btn" href="{{link}}">Open candidate &amp; submit feedback</a></p><p>Meeting link: <a href="{{meetingUrl}}">{{meetingUrl}}</a></p>'),
('offer_sent', 'Offer letter', 'Offer sent to a candidate',
 'Your offer from {{companyName}} - {{jobTitle}}',
 '<p>Hi {{candidateName}},</p><p>We are delighted to offer you the position of <strong>{{designation}}</strong> at {{companyName}}!</p><p>Please review the details of your offer, then accept it or reach out to us with any questions.</p><p><a class="btn" href="{{link}}">View your offer</a></p><p>This offer is valid until {{expiresAt}}.</p>'),
('offer_revised', 'Offer revised', 'Sent after an offer is revised during negotiation',
 'Your revised offer from {{companyName}}',
 '<p>Hi {{candidateName}},</p><p>We have revised your offer for <strong>{{designation}}</strong> based on our discussion.</p><p><a class="btn" href="{{link}}">Review revised offer</a></p><p>This offer is valid until {{expiresAt}}.</p>'),
('offer_response_internal', 'Offer response (internal)', 'Notifies the recruiter when a candidate responds to an offer',
 '{{candidateName}} {{response}} the offer for {{jobTitle}}',
 '<p>{{candidateName}} has <strong>{{response}}</strong> the offer for <strong>{{jobTitle}}</strong>.</p><p>{{message}}</p><p><a class="btn" href="{{link}}">Open offer</a></p>'),
('onboarding_invite', 'Pre-joining documents', 'Asks a candidate to upload pre-joining documents',
 'Welcome aboard! Next steps before you join {{companyName}}',
 '<p>Hi {{candidateName}},</p><p>Welcome to {{companyName}}! We are excited to have you join us as <strong>{{jobTitle}}</strong> on <strong>{{joiningDate}}</strong>.</p><p>To complete pre-joining formalities and background verification, please upload your documents using the secure link below.</p><p><a class="btn" href="{{link}}">Upload documents</a></p>'),
('document_rejected', 'Document re-upload needed', 'Sent when an uploaded document is rejected',
 'Action needed: please re-upload {{documentName}}',
 '<p>Hi {{candidateName}},</p><p>We could not accept your <strong>{{documentName}}</strong>: {{reason}}</p><p><a class="btn" href="{{link}}">Re-upload document</a></p>'),
('bgv_request', 'Background verification request', 'Sent to the third-party verification vendor',
 'BGV request: {{candidateName}} ({{referenceNo}})',
 '<p>Hello {{vendorName}},</p><p>Please initiate background verification for <strong>{{candidateName}}</strong> ({{candidateEmail}}), joining {{companyName}} as <strong>{{jobTitle}}</strong>.</p><p>Reference: <strong>{{referenceNo}}</strong></p><p>Documents (secure links valid for 7 days):</p>{{{documentsHtml}}}<p>Please reply to this email with the verification report.</p><p>Thanks,<br/>{{companyName}} HR</p>'),
('rejection', 'Application update (rejection)', 'Polite rejection sent to a candidate',
 'Update on your application for {{jobTitle}}',
 '<p>Hi {{candidateName}},</p><p>Thank you for your interest in the <strong>{{jobTitle}}</strong> role at {{companyName}} and for the time you invested in our process.</p><p>After careful consideration, we have decided to move forward with other candidates. We will keep your profile on file for future opportunities.</p><p>We wish you all the best.<br/>{{companyName}} Talent Team</p>'),
('generic', 'Custom message', 'Free-form message composed by a recruiter',
 '{{subject}}',
 '{{{bodyHtml}}}');
