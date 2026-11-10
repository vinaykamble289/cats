import type { FastifyBaseLogger } from 'fastify';
import {
  addDays,
  callService,
  createToken,
  formatDate,
  notFound,
  portalUrl,
  queueEmailSafe,
  type ApplicationStage,
  type ApplicationStatus,
  type Db,
} from '@hireflow/shared';
import { sql } from '../db.js';

export type Row = Record<string, any>;

export const TOKEN_DAYS = 30;

/** Case row + document progress counters. */
export const caseSelect = () => sql`
  select c.*,
    (select json_build_object(
        'total', count(*),
        'uploaded', count(*) filter (where d.status = 'uploaded'),
        'verified', count(*) filter (where d.status = 'verified'),
        'rejected', count(*) filter (where d.status = 'rejected'),
        'requiredPending', count(*) filter (where t.is_required and d.status in ('pending', 'rejected'))
      )
      from onboarding.case_documents d join onboarding.document_types t on t.id = d.document_type_id
      where d.case_id = c.id) as document_stats
  from onboarding.cases c
`;

export function toCase(c: Row) {
  const { tokenHash: _t, tokenExpiresAt: _e, ...rest } = c;
  return rest;
}

export async function getCase(db: Db, id: string) {
  const [c] = await db`${caseSelect()} where c.id = ${id}`;
  if (!c) throw notFound('Onboarding case');
  return c;
}

export async function caseDocuments(db: Db, caseId: string) {
  return db`
    select d.id, d.document_type_id, t.code, t.name, t.description, t.is_required, d.status, d.file_name,
           d.mime_type, d.size_bytes, d.uploaded_at, d.review_note, d.reviewed_at, d.storage_path
    from onboarding.case_documents d join onboarding.document_types t on t.id = d.document_type_id
    where d.case_id = ${caseId}
    order by t.sort_order, t.name
  `;
}

export function eventBase(c: Row) {
  return { aggregateType: 'onboarding_case', aggregateId: c.id as string, candidateId: c.candidateId, jobId: c.jobId, applicationId: c.applicationId };
}

/** Rotates the candidate portal token (only hashes are stored, so every email gets a fresh link). */
export async function rotateToken(db: Db, caseId: string): Promise<string> {
  const { token, hash } = createToken();
  await db`update onboarding.cases set token_hash = ${hash}, token_expires_at = ${addDays(TOKEN_DAYS)} where id = ${caseId}`;
  return token;
}

export async function emailInvite(c: Row, token: string, actorId: string | null | undefined, log: FastifyBaseLogger) {
  await queueEmailSafe(
    {
      templateKey: 'onboarding_invite',
      to: c.candidateEmail,
      data: {
        candidateName: c.candidateName,
        jobTitle: c.jobTitle,
        joiningDate: c.joiningDate ? formatDate(c.joiningDate) : 'your joining date',
        link: portalUrl('onboarding', token),
      },
      relatedType: 'onboarding_case',
      relatedId: c.id,
      candidateId: c.candidateId,
      createdBy: actorId ?? undefined,
    },
    log,
  );
}

export async function updateApplication(
  applicationId: string,
  body: { stage?: ApplicationStage; status?: ApplicationStatus; note?: string; actorId?: string | null },
  log: FastifyBaseLogger,
): Promise<boolean> {
  try {
    await callService('talent', `/internal/applications/${applicationId}/stage`, { method: 'POST', body: { ...body, actorId: body.actorId ?? undefined } });
    return true;
  } catch (err) {
    log.error({ err, applicationId, body }, 'Failed to update application');
    return false;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
