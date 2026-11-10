import { randomUUID } from 'node:crypto';
import { badRequest, publishEvent, removeFile, uploadFile, type Db } from '@hireflow/shared';
import type { FastifyBaseLogger } from 'fastify';
import { sql } from '../db.js';
import { createApplication } from './applications.js';
import { extractResumeText, RESUME_MIME, requireKind } from './extract.js';
import { parseResume, type ParsedProfile } from './parse.js';

export type CandidateSource = 'career_page' | 'manual_upload' | 'bulk_upload' | 'email' | 'referral' | 'linkedin' | 'job_board' | 'agency' | 'other';

/** Profile fields that may be supplied explicitly (form input) - these override parsed values. */
export interface CandidateOverrides {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  linkedinUrl?: string | null;
  experienceYears?: number | null;
  noticePeriodDays?: number | null;
  currentCtc?: number | null;
  expectedCtc?: number | null;
}

export interface IngestInput {
  buffer: Buffer;
  fileName: string;
  mimeType?: string;
  source: CandidateSource;
  sourceDetail?: string | null;
  job?: { id: string; title: string } | null;
  overrides?: CandidateOverrides;
  actorId?: string | null;
  /** When true, a resume without extractable text / email is still accepted (email must come from overrides). */
  lenient?: boolean;
  log?: FastifyBaseLogger;
}

export interface IngestResult {
  status: 'created' | 'updated';
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  applicationId?: string;
  applicationCreated?: boolean;
}

/** Inserts skills (dedupe case-insensitively). */
export async function addSkills(tx: Db, candidateId: string, skills: string[]): Promise<void> {
  const clean = [...new Map(skills.map((s) => s.trim()).filter(Boolean).map((s) => [s.toLowerCase(), s.slice(0, 60)])).values()];
  if (!clean.length) return;
  await tx`
    insert into talent.candidate_skills (candidate_id, name)
    select ${candidateId}, unnest(${clean}::text[])
    on conflict do nothing
  `;
}

/**
 * Full resume ingestion: extract text -> parse (AI or fallback) -> upsert candidate by email
 * (existing profile fields are only filled when empty) -> store file -> new primary resume -> optional application.
 */
export async function ingestResume(input: IngestInput): Promise<IngestResult> {
  const kind = requireKind(input.fileName, input.mimeType);
  let text = '';
  try {
    text = await extractResumeText(input.buffer, kind);
  } catch (err) {
    if (!input.lenient) throw badRequest(`Could not read "${input.fileName}" - the file may be corrupt or password protected.`);
    input.log?.warn({ err: (err as Error).message }, 'Resume text extraction failed');
  }
  if (!text && !input.lenient) throw badRequest(`No readable text found in "${input.fileName}" (scanned image PDFs are not supported).`);

  const parsed: ParsedProfile = await parseResume(text, input.fileName, input.log);
  const o = input.overrides ?? {};
  const email = (o.email ?? parsed.email)?.trim().toLowerCase();
  if (!email) throw badRequest(`No email address found in "${input.fileName}". Add the candidate manually instead.`);
  const fullName = (o.fullName ?? parsed.fullName ?? '').trim() || email.split('@')[0]!;

  const [existing] = await sql<{ id: string }[]>`select id from talent.candidates where email = ${email}`;
  const candidateId = existing?.id ?? randomUUID();
  const storagePath = await uploadFile(`resumes/${candidateId}`, input.fileName, input.buffer, input.mimeType || RESUME_MIME[kind]);

  try {
    return await sql.begin(async (tx) => {
      const [row] = await tx<{ id: string; fullName: string; inserted: boolean }[]>`
        insert into talent.candidates (
          id, full_name, email, phone, location, current_title, current_company, experience_years,
          linkedin_url, portfolio_url, summary, source, source_detail, notice_period_days, current_ctc, expected_ctc, created_by
        ) values (
          ${candidateId}, ${fullName}, ${email}, ${o.phone ?? parsed.phone}, ${o.location ?? parsed.location},
          ${parsed.currentTitle}, ${parsed.currentCompany}, ${o.experienceYears ?? parsed.experienceYears},
          ${o.linkedinUrl ?? parsed.linkedinUrl}, ${parsed.portfolioUrl}, ${parsed.summary}, ${input.source},
          ${input.sourceDetail ?? null}, ${o.noticePeriodDays ?? null}, ${o.currentCtc ?? null}, ${o.expectedCtc ?? null}, ${input.actorId ?? null}
        )
        on conflict (email) do update set
          full_name = coalesce(${o.fullName ?? null}, talent.candidates.full_name),
          phone = coalesce(${o.phone ?? null}, talent.candidates.phone, excluded.phone),
          location = coalesce(${o.location ?? null}, talent.candidates.location, excluded.location),
          current_title = coalesce(talent.candidates.current_title, excluded.current_title),
          current_company = coalesce(talent.candidates.current_company, excluded.current_company),
          experience_years = coalesce(${o.experienceYears ?? null}, talent.candidates.experience_years, excluded.experience_years),
          linkedin_url = coalesce(${o.linkedinUrl ?? null}, talent.candidates.linkedin_url, excluded.linkedin_url),
          portfolio_url = coalesce(talent.candidates.portfolio_url, excluded.portfolio_url),
          summary = coalesce(talent.candidates.summary, excluded.summary),
          notice_period_days = coalesce(${o.noticePeriodDays ?? null}, talent.candidates.notice_period_days),
          current_ctc = coalesce(${o.currentCtc ?? null}, talent.candidates.current_ctc),
          expected_ctc = coalesce(${o.expectedCtc ?? null}, talent.candidates.expected_ctc)
        returning id, full_name, (xmax = 0) as inserted
      `;
      const id = row!.id;
      await addSkills(tx, id, parsed.skills);
      await tx`update talent.resumes set is_primary = false where candidate_id = ${id} and is_primary`;
      const parsedJson = { education: parsed.education, experience: parsed.experience, skills: parsed.skills, ai: parsed.ai };
      await tx`
        insert into talent.resumes (candidate_id, storage_path, file_name, mime_type, size_bytes, text_content, parsed, is_primary, uploaded_by)
        values (${id}, ${storagePath}, ${input.fileName.slice(0, 250)}, ${input.mimeType || RESUME_MIME[kind]}, ${input.buffer.length},
                ${text || null}, ${tx.json(parsedJson as never)}, true, ${input.actorId ?? null})
      `;
      if (row!.inserted) {
        await publishEvent(tx, {
          type: 'candidate.created',
          aggregateType: 'candidate',
          aggregateId: id,
          candidateId: id,
          actorId: input.actorId ?? null,
          payload: { candidateName: row!.fullName, source: input.source },
        });
      }
      await publishEvent(tx, {
        type: 'resume.uploaded',
        aggregateType: 'candidate',
        aggregateId: id,
        candidateId: id,
        actorId: input.actorId ?? null,
        payload: { candidateName: row!.fullName, fileName: input.fileName },
      });

      let applicationId: string | undefined;
      let applicationCreated: boolean | undefined;
      if (input.job) {
        const app = await createApplication(tx, {
          candidateId: id,
          candidateName: row!.fullName,
          jobId: input.job.id,
          jobTitle: input.job.title,
          actorId: input.actorId ?? null,
          source: input.source,
        });
        applicationId = app.id;
        applicationCreated = app.created;
      }
      return {
        status: row!.inserted ? 'created' : 'updated',
        candidateId: id,
        candidateName: row!.fullName,
        candidateEmail: email,
        applicationId,
        applicationCreated,
      } satisfies IngestResult;
    });
  } catch (err) {
    await removeFile(storagePath).catch(() => {});
    throw err;
  }
}

/** Runs async tasks with limited concurrency, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}
