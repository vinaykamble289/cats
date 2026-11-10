import type { FastifyInstance } from 'fastify';
import {
  ALLOWED_DOCUMENT_TYPES,
  badRequest,
  conflict,
  env,
  gone,
  hashToken,
  notFound,
  parse,
  publishEvent,
  removeFile,
  uploadFile,
  uuid,
  z,
} from '@hireflow/shared';
import { sql } from '../db.js';
import { caseDocuments, eventBase, type Row } from '../lib/cases.js';

const tokenParams = z.object({ token: z.string().min(20).max(200) });
const docParams = z.object({ token: z.string().min(20).max(200), docId: uuid });

async function findByToken(token: string): Promise<Row> {
  const [c] = await sql`select * from onboarding.cases where token_hash = ${hashToken(token)}`;
  if (!c) throw notFound('Onboarding link');
  if (c.status === 'dropped') throw gone('This onboarding link is no longer active.');
  if (c.tokenExpiresAt && new Date(c.tokenExpiresAt) < new Date()) throw gone('This link has expired. Please contact HR for a new one.');
  return c;
}

export async function publicRoutes(app: FastifyInstance) {
  app.get('/public/onboarding/:token', async (req) => {
    const { token } = parse(tokenParams, req.params);
    const c = await findByToken(token);
    const docs = await caseDocuments(sql, c.id);
    return {
      candidateName: c.candidateName,
      jobTitle: c.jobTitle,
      joiningDate: c.joiningDate,
      companyName: env.companyName,
      status: c.status,
      documents: docs.map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description,
        isRequired: d.isRequired,
        status: d.status,
        fileName: d.fileName,
        reviewNote: d.status === 'rejected' ? d.reviewNote : null,
      })),
    };
  });

  app.post('/public/onboarding/:token/documents/:docId', async (req) => {
    const { token, docId } = parse(docParams, req.params);
    const c = await findByToken(token);
    if (c.status === 'joined') throw conflict('Your onboarding is already complete.');

    const [doc] = await sql`select * from onboarding.case_documents where id = ${docId} and case_id = ${c.id}`;
    if (!doc) throw notFound('Document');
    if (doc.status === 'verified') throw conflict('This document has already been verified.');

    if (!req.isMultipart()) throw badRequest('Upload the file as multipart/form-data');
    const file = await req.file();
    if (!file) throw badRequest('Please choose a file to upload');
    if (!ALLOWED_DOCUMENT_TYPES.includes(file.mimetype)) throw badRequest('Unsupported file type. Upload a PDF, image (JPG/PNG/WebP) or Word document.');
    const buffer = await file.toBuffer();
    if (file.file.truncated) throw badRequest('File is too large (max 10 MB)');
    if (!buffer.length) throw badRequest('The file is empty');

    const path = await uploadFile(`onboarding/${c.id}`, file.filename, buffer, file.mimetype);
    const oldPath: string | null = doc.storagePath;

    try {
      await sql.begin(async (tx) => {
        const [locked] = await tx`select status from onboarding.cases where id = ${c.id} for update`;
        await tx`
          update onboarding.case_documents
          set status = 'uploaded', storage_path = ${path}, file_name = ${file.filename}, mime_type = ${file.mimetype},
              size_bytes = ${buffer.length}, uploaded_at = now(), review_note = null, reviewed_by = null, reviewed_at = null
          where id = ${docId}
        `;
        const [{ pending }] = await tx`
          select count(*)::int as pending
          from onboarding.case_documents d join onboarding.document_types t on t.id = d.document_type_id
          where d.case_id = ${c.id} and t.is_required and d.status in ('pending', 'rejected')
        `;
        if (pending === 0 && locked.status === 'collecting_documents') {
          await tx`update onboarding.cases set status = 'documents_submitted' where id = ${c.id}`;
        }
        const [t] = await tx`select name from onboarding.document_types where id = ${doc.documentTypeId}`;
        await publishEvent(tx, {
          type: 'onboarding.document_uploaded',
          ...eventBase(c),
          payload: { candidateName: c.candidateName, jobTitle: c.jobTitle, documentName: t?.name, allRequiredUploaded: pending === 0 },
        });
      });
    } catch (err) {
      await removeFile(path).catch(() => undefined);
      throw err;
    }
    if (oldPath && oldPath !== path) await removeFile(oldPath).catch((err) => req.log.warn({ err, oldPath }, 'Could not remove replaced file'));
    return { ok: true };
  });
}
