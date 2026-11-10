import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import {
  addDays,
  badRequest,
  callService,
  conflict,
  createToken,
  csvList,
  email,
  idParams,
  notFound,
  optionalText,
  paginationQuery,
  parse,
  portalUrl,
  publishEvent,
  queueEmailSafe,
  requireRole,
  signedUrl,
  toLimitOffset,
  uuid,
  z,
} from '@hireflow/shared';
import { sql } from '../db.js';
import {
  caseDocuments,
  caseSelect,
  emailInvite,
  escapeHtml,
  eventBase,
  getCase,
  rotateToken,
  TOKEN_DAYS,
  toCase,
  updateApplication,
} from '../lib/cases.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const createCaseBody = z.object({
  applicationId: uuid,
  candidateId: uuid,
  jobId: uuid,
  offerId: uuid.nullish(),
  candidateName: z.string().trim().min(1).max(200),
  candidateEmail: email,
  jobTitle: z.string().trim().min(1).max(200),
  joiningDate: isoDate.nullish(),
});

const listQuery = paginationQuery.extend({
  status: csvList,
  candidateId: uuid.optional(),
  applicationId: uuid.optional(),
});

const docParams = z.object({ id: uuid, docId: uuid });
const bgvParams = z.object({ id: uuid, requestId: uuid });

function defaultReference(): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `BGV-${ymd}-${randomBytes(2).toString('hex').toUpperCase()}`;
}

async function caseDetail(id: string) {
  const c = await getCase(sql, id);
  const [documents, bgvRequests] = await Promise.all([
    caseDocuments(sql, id),
    sql`
      select b.id, b.vendor_id, v.name as vendor_name, b.status, b.reference_no, b.sent_at, b.completed_at, b.result_summary
      from onboarding.bgv_requests b join onboarding.bgv_vendors v on v.id = b.vendor_id
      where b.case_id = ${id} order by b.sent_at desc
    `,
  ]);
  return { ...toCase(c), documents: documents.map(({ storagePath: _p, ...d }) => d), bgvRequests };
}

export async function caseRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------- internal
  app.post('/internal/cases', async (req) => {
    const body = parse(createCaseBody, req.body);
    const [existing] = await sql`select id from onboarding.cases where application_id = ${body.applicationId}`;
    if (existing) return toCase(await getCase(sql, existing.id));

    const { token, hash } = createToken();
    const created = await sql.begin(async (tx) => {
      const [c] = await tx`
        insert into onboarding.cases ${tx({
          applicationId: body.applicationId,
          candidateId: body.candidateId,
          jobId: body.jobId,
          offerId: body.offerId ?? null,
          candidateName: body.candidateName,
          candidateEmail: body.candidateEmail,
          jobTitle: body.jobTitle,
          joiningDate: body.joiningDate ?? null,
          tokenHash: hash,
          tokenExpiresAt: addDays(TOKEN_DAYS),
        })}
        on conflict (application_id) do nothing
        returning *
      `;
      if (!c) return null;
      await tx`
        insert into onboarding.case_documents (case_id, document_type_id)
        select ${c.id}, id from onboarding.document_types where is_active
      `;
      await publishEvent(tx, {
        type: 'onboarding.created',
        ...eventBase(c),
        payload: { candidateName: c.candidateName, jobTitle: c.jobTitle, joiningDate: c.joiningDate },
      });
      return c;
    });
    if (!created) {
      const [c] = await sql`select id from onboarding.cases where application_id = ${body.applicationId}`;
      return toCase(await getCase(sql, c.id));
    }
    await emailInvite(created, token, null, req.log);
    return toCase(await getCase(sql, created.id));
  });

  // ---------------------------------------------------------------- list & stats
  app.get('/onboarding', async (req) => {
    const q = parse(listQuery, req.query);
    const { limit, offset } = toLimitOffset(q);
    const conds = [sql`true`];
    if (q.status?.length) conds.push(sql`c.status::text = any(${q.status})`);
    if (q.candidateId) conds.push(sql`c.candidate_id = ${q.candidateId}`);
    if (q.applicationId) conds.push(sql`c.application_id = ${q.applicationId}`);
    const where = conds.reduce((a, b) => sql`${a} and ${b}`);
    const [rows, [{ total }]] = await Promise.all([
      sql`${caseSelect()} where ${where} order by c.joining_date asc nulls last, c.created_at desc limit ${limit} offset ${offset}`,
      sql`select count(*)::int as total from onboarding.cases c where ${where}`,
    ]);
    return { data: rows.map(toCase), total };
  });

  app.get('/onboarding/stats', async () => {
    const [byStatus, [agg]] = await Promise.all([
      sql`select status::text as status, count(*)::int as count from onboarding.cases group by status`,
      sql`
        select count(*)::int as joining from onboarding.cases
        where status not in ('joined', 'dropped') and joining_date between current_date and current_date + 30
      `,
    ]);
    return { byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.count])), joiningNext30Days: agg.joining };
  });

  app.get('/onboarding/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    return caseDetail(id);
  });

  app.patch('/onboarding/:id', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const { joiningDate } = parse(z.object({ joiningDate: isoDate.nullable() }), req.body);
    await sql.begin(async (tx) => {
      const [c] = await tx`update onboarding.cases set joining_date = ${joiningDate} where id = ${id} returning *`;
      if (!c) throw notFound('Onboarding case');
      await publishEvent(tx, { type: 'onboarding.updated', ...eventBase(c), actorId: user.id, payload: { candidateName: c.candidateName, jobTitle: c.jobTitle, joiningDate } });
    });
    return caseDetail(id);
  });

  // ---------------------------------------------------------------- documents
  app.get('/onboarding/:id/documents/:docId/url', async (req) => {
    const { id, docId } = parse(docParams, req.params);
    const [d] = await sql`select storage_path, file_name from onboarding.case_documents where id = ${docId} and case_id = ${id}`;
    if (!d) throw notFound('Document');
    if (!d.storagePath) throw badRequest('This document has not been uploaded yet');
    return { url: await signedUrl(d.storagePath, 600) };
  });

  app.post('/onboarding/:id/documents/:docId/review', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id, docId } = parse(docParams, req.params);
    const body = parse(z.object({ status: z.enum(['verified', 'rejected']), note: optionalText(2000) }), req.body);
    if (body.status === 'rejected' && !body.note) throw badRequest('Please give a reason so the candidate knows what to fix');

    const result = await sql.begin(async (tx) => {
      const [c] = await tx`select * from onboarding.cases where id = ${id} for update`;
      if (!c) throw notFound('Onboarding case');
      const [d] = await tx`
        select d.*, t.name from onboarding.case_documents d join onboarding.document_types t on t.id = d.document_type_id
        where d.id = ${docId} and d.case_id = ${id}
      `;
      if (!d) throw notFound('Document');
      if (!d.storagePath) throw conflict('This document has not been uploaded yet');
      await tx`
        update onboarding.case_documents
        set status = ${body.status}, review_note = ${body.note ?? null}, reviewed_by = ${user.id}, reviewed_at = now()
        where id = ${docId}
      `;
      if (body.status === 'rejected' && c.status === 'documents_submitted') {
        await tx`update onboarding.cases set status = 'collecting_documents' where id = ${id}`;
      }
      await publishEvent(tx, {
        type: 'onboarding.document_reviewed',
        ...eventBase(c),
        actorId: user.id,
        payload: { candidateName: c.candidateName, jobTitle: c.jobTitle, documentName: d.name, status: body.status, note: body.note ?? null },
      });
      const token = body.status === 'rejected' ? await rotateToken(tx, id) : null;
      return { c, documentName: d.name as string, token };
    });

    if (result.token) {
      await queueEmailSafe(
        {
          templateKey: 'document_rejected',
          to: result.c.candidateEmail,
          data: { candidateName: result.c.candidateName, documentName: result.documentName, reason: body.note ?? '', link: portalUrl('onboarding', result.token) },
          relatedType: 'onboarding_case',
          relatedId: id,
          candidateId: result.c.candidateId,
          createdBy: user.id,
        },
        req.log,
      );
    }
    return caseDetail(id);
  });

  app.post('/onboarding/:id/resend-invite', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const c = await getCase(sql, id);
    if (['joined', 'dropped'].includes(c.status)) throw conflict(`This case is ${c.status}`);
    const token = await rotateToken(sql, id);
    await emailInvite(c, token, user.id, req.log);
    return { ok: true };
  });

  // ---------------------------------------------------------------- background verification
  app.post('/onboarding/:id/bgv', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ vendorId: uuid, referenceNo: optionalText(100) }), req.body);
    const c = await getCase(sql, id);
    if (['joined', 'dropped'].includes(c.status)) throw conflict(`This case is ${c.status}`);
    const [vendor] = await sql`select * from onboarding.bgv_vendors where id = ${body.vendorId}`;
    if (!vendor || !vendor.isActive) throw badRequest('Select an active verification vendor');

    const docs = (await caseDocuments(sql, id)).filter((d) => d.storagePath && ['uploaded', 'verified'].includes(d.status));
    if (!docs.length) throw badRequest('No uploaded documents to send for verification');
    const links = await Promise.all(docs.map((d) => signedUrl(d.storagePath, 7 * 24 * 60 * 60, d.fileName ?? undefined)));
    const documentsHtml = `<ul>${docs
      .map((d, i) => `<li><a href="${escapeHtml(links[i])}">${escapeHtml(d.name)}</a>${d.fileName ? ` (${escapeHtml(d.fileName)})` : ''}</li>`)
      .join('')}</ul>`;
    const referenceNo = body.referenceNo || defaultReference();

    await sql.begin(async (tx) => {
      await tx`
        insert into onboarding.bgv_requests ${tx({ caseId: id, vendorId: vendor.id, referenceNo, createdBy: user.id })}
      `;
      await tx`update onboarding.cases set status = 'bgv_in_progress' where id = ${id}`;
      await publishEvent(tx, {
        type: 'onboarding.bgv_sent',
        ...eventBase(c),
        actorId: user.id,
        payload: { candidateName: c.candidateName, jobTitle: c.jobTitle, vendorName: vendor.name, referenceNo, documentCount: docs.length },
      });
    });

    await queueEmailSafe(
      {
        templateKey: 'bgv_request',
        to: vendor.contactEmail,
        data: {
          vendorName: vendor.contactName || vendor.name,
          candidateName: c.candidateName,
          candidateEmail: c.candidateEmail,
          jobTitle: c.jobTitle,
          referenceNo,
          documentsHtml,
        },
        relatedType: 'onboarding_case',
        relatedId: id,
        candidateId: c.candidateId,
        createdBy: user.id,
      },
      req.log,
    );
    return caseDetail(id);
  });

  app.patch('/onboarding/:id/bgv/:requestId', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id, requestId } = parse(bgvParams, req.params);
    const body = parse(
      z.object({ status: z.enum(['in_progress', 'cleared', 'flagged', 'cancelled']), resultSummary: optionalText(5000) }),
      req.body,
    );
    await sql.begin(async (tx) => {
      const [c] = await tx`select * from onboarding.cases where id = ${id} for update`;
      if (!c) throw notFound('Onboarding case');
      const final = ['cleared', 'flagged'].includes(body.status);
      const [b] = await tx`
        update onboarding.bgv_requests
        set status = ${body.status}, result_summary = coalesce(${body.resultSummary ?? null}, result_summary),
            completed_at = case when ${final} then now() else completed_at end
        where id = ${requestId} and case_id = ${id} returning *
      `;
      if (!b) throw notFound('Verification request');
      if (!['joined', 'dropped'].includes(c.status)) {
        let next: string | null = null;
        if (body.status === 'cleared') next = 'bgv_cleared';
        else if (body.status === 'flagged') next = 'bgv_flagged';
        else if (body.status === 'in_progress') next = 'bgv_in_progress';
        else {
          const [{ active }] = await tx`
            select count(*)::int as active from onboarding.bgv_requests where case_id = ${id} and status in ('sent', 'in_progress')
          `;
          if (!active && c.status === 'bgv_in_progress') next = 'documents_submitted';
        }
        if (next) await tx`update onboarding.cases set status = ${next} where id = ${id}`;
      }
      await publishEvent(tx, {
        type: 'onboarding.bgv_updated',
        ...eventBase(c),
        actorId: user.id,
        payload: { candidateName: c.candidateName, jobTitle: c.jobTitle, status: body.status, referenceNo: b.referenceNo },
      });
    });
    return caseDetail(id);
  });

  // ---------------------------------------------------------------- join / drop
  app.post('/onboarding/:id/join', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const { joinedAt } = parse(z.object({ joinedAt: z.union([isoDate, z.string().datetime({ offset: true })]).nullish() }), req.body);
    const c = await sql.begin(async (tx) => {
      const [row] = await tx`select * from onboarding.cases where id = ${id} for update`;
      if (!row) throw notFound('Onboarding case');
      if (['joined', 'dropped'].includes(row.status)) throw conflict(`This case is already ${row.status}`);
      const when = joinedAt ? new Date(joinedAt) : new Date();
      const [u] = await tx`update onboarding.cases set status = 'joined', joined_at = ${when}, token_hash = null where id = ${id} returning *`;
      await publishEvent(tx, {
        type: 'onboarding.joined',
        ...eventBase(u),
        actorId: user.id,
        payload: { candidateName: u.candidateName, jobTitle: u.jobTitle, joinedAt: when.toISOString() },
      });
      return u;
    });

    const warnings: string[] = [];
    if (!(await updateApplication(c.applicationId, { stage: 'joined', status: 'hired', note: 'Candidate joined', actorId: user.id }, req.log))) {
      warnings.push('Could not update the candidate pipeline');
    }
    try {
      await callService('jobs', `/internal/jobs/${c.jobId}/fill`, { method: 'POST', body: {} });
    } catch (err) {
      req.log.error({ err, jobId: c.jobId }, 'Failed to update job openings');
      warnings.push('Could not update the job opening count');
    }
    return { ...(await caseDetail(id)), syncWarnings: warnings };
  });

  app.post('/onboarding/:id/drop', async (req) => {
    const user = requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(1).max(2000) }), req.body);
    const c = await sql.begin(async (tx) => {
      const [row] = await tx`select * from onboarding.cases where id = ${id} for update`;
      if (!row) throw notFound('Onboarding case');
      if (['joined', 'dropped'].includes(row.status)) throw conflict(`This case is already ${row.status}`);
      const [u] = await tx`update onboarding.cases set status = 'dropped', dropped_reason = ${reason}, token_hash = null where id = ${id} returning *`;
      await publishEvent(tx, { type: 'onboarding.dropped', ...eventBase(u), actorId: user.id, payload: { candidateName: u.candidateName, jobTitle: u.jobTitle, reason } });
      return u;
    });
    await updateApplication(c.applicationId, { status: 'withdrawn', note: `Did not join: ${reason}`, actorId: user.id }, req.log);
    return caseDetail(id);
  });
}

