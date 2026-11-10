import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { FastifyInstance } from 'fastify';
import { callService, every, optional, type JobContext } from '@hireflow/shared';
import { sql } from '../db.js';
import { scheduleAiMatch } from '../lib/applications.js';
import { detectKind } from '../lib/extract.js';
import { ingestResume } from '../lib/ingest.js';

/**
 * Imports resumes emailed to the recruiting inbox (enabled when IMAP_HOST is set).
 * Every unseen message with PDF/DOCX attachments becomes/updates a candidate (source = email).
 * Messages are deduped by Message-ID in talent.inbound_emails and marked as seen.
 * A job code in the subject (e.g. "JOB-1001") links the candidate to that job when it is open.
 */
export function imapWorker(signal: AbortSignal, app: FastifyInstance): void {
  const host = optional('IMAP_HOST');
  if (!host) return;
  const intervalMs = Math.max(30, Number(optional('IMAP_POLL_SECONDS', '120'))) * 1000;
  app.log.info({ host }, 'Resume inbox import enabled');
  every(intervalMs, () => pollInbox(app), app.log, 'IMAP resume import')(signal);
}

async function pollInbox(app: FastifyInstance): Promise<void> {
  const client = new ImapFlow({
    host: optional('IMAP_HOST'),
    port: Number(optional('IMAP_PORT', '993')),
    secure: Number(optional('IMAP_PORT', '993')) === 993,
    auth: { user: optional('IMAP_USER'), pass: optional('IMAP_PASS') },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock(optional('IMAP_MAILBOX', 'INBOX'));
  try {
    const uids = (await client.search({ seen: false }, { uid: true })) || [];
    for (const uid of uids.slice(0, 25)) {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const mail = await simpleParser(msg.source);
      const messageId = mail.messageId ?? `uid-${uid}-${mail.date?.toISOString() ?? ''}`;
      const [seen] = await sql`select 1 from talent.inbound_emails where message_id = ${messageId}`;
      if (!seen) await processMessage(app, messageId, mail);
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
}

async function processMessage(app: FastifyInstance, messageId: string, mail: Awaited<ReturnType<typeof simpleParser>>) {
  const fromEmail = mail.from?.value?.[0]?.address?.toLowerCase() ?? null;
  const resumes = (mail.attachments ?? []).filter((a) => detectKind(a.filename ?? '', a.contentType) && detectKind(a.filename ?? '', a.contentType) !== 'txt');
  const record = (status: 'processed' | 'skipped' | 'failed', candidateId: string | null, error: string | null) => sql`
    insert into talent.inbound_emails (message_id, from_email, subject, received_at, candidate_id, status, error)
    values (${messageId}, ${fromEmail}, ${mail.subject?.slice(0, 500) ?? null}, ${mail.date ?? null}, ${candidateId}, ${status}, ${error})
    on conflict (message_id) do nothing
  `;
  if (!resumes.length) return record('skipped', null, 'No resume attachment');

  const code = /JOB-\d+/i.exec(mail.subject ?? '')?.[0];
  let job: { id: string; title: string } | null = null;
  if (code) {
    try {
      const ctx = await callService<JobContext>('jobs', `/internal/jobs/by-code/${encodeURIComponent(code)}`);
      if (ctx.status === 'open') job = { id: ctx.id, title: ctx.title };
    } catch {
      app.log.warn({ code }, 'Job code in resume email not found');
    }
  }

  let candidateId: string | null = null;
  const errors: string[] = [];
  for (const att of resumes) {
    try {
      const r = await ingestResume({
        buffer: att.content,
        fileName: att.filename ?? 'resume.pdf',
        mimeType: att.contentType,
        source: 'email',
        job,
        sourceDetail: fromEmail ? `Email from ${fromEmail}` : 'Email inbox',
        log: app.log,
      });
      candidateId = r.candidateId;
      if (r.applicationId && r.applicationCreated) scheduleAiMatch([r.applicationId], app.log);
    } catch (err) {
      errors.push(`${att.filename}: ${(err as Error).message}`);
    }
  }
  await record(candidateId ? 'processed' : 'failed', candidateId, errors.length ? errors.join('; ').slice(0, 2000) : null);
}
