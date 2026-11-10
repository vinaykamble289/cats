import nodemailer, { type Transporter } from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import { optional } from '@hireflow/shared';
import { sql } from './db.js';
import { htmlToText } from './render.js';

const MAX_ATTEMPTS = 5;
const BATCH = 10;

let transporter: Transporter | undefined;

export const isDryRun = () => optional('EMAIL_DRY_RUN', 'false').toLowerCase() === 'true';
export const smtpConfigured = () => !!optional('SMTP_HOST');

function getTransport(): Transporter {
  if (!smtpConfigured()) throw new Error('SMTP is not configured (SMTP_HOST is empty)');
  transporter ??= nodemailer.createTransport({
    host: optional('SMTP_HOST'),
    port: Number(optional('SMTP_PORT', '465')),
    secure: optional('SMTP_SECURE', 'true').toLowerCase() === 'true',
    auth: optional('SMTP_USER') ? { user: optional('SMTP_USER'), pass: optional('SMTP_PASS') } : undefined,
    pool: true,
    maxConnections: 3,
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return transporter;
}

export async function verifySmtp(log: FastifyBaseLogger): Promise<void> {
  if (isDryRun()) return log.warn('EMAIL_DRY_RUN=true - emails will be logged, not sent');
  if (!smtpConfigured()) return log.warn('SMTP_HOST not set - queued emails will fail until SMTP is configured');
  try {
    await getTransport().verify();
    log.info('SMTP connection verified');
  } catch (err) {
    log.error({ err: (err as Error).message }, 'SMTP verification failed - check SMTP_* settings');
  }
}

interface Attachment {
  filename: string;
  content: string;
  contentType: string;
}

interface ClaimedEmail {
  id: string;
  toEmail: string;
  cc: string[];
  subject: string;
  bodyHtml: string;
  attachments: Attachment[];
  attempts: number;
}

/** Claims due emails (skip locked => safe with multiple replicas), sends them, records the outcome. */
export async function processOutbox(log: FastifyBaseLogger): Promise<number> {
  // Recover rows stuck in 'sending' (process crashed mid-send)
  await sql`update notify.emails set status = 'queued' where status = 'sending' and next_attempt_at < now() - interval '10 minutes'`;

  const claimed = await sql<ClaimedEmail[]>`
    with due as (
      select id from notify.emails
      where status = 'queued' and next_attempt_at <= now()
      order by next_attempt_at
      limit ${BATCH}
      for update skip locked
    )
    update notify.emails e
    set status = 'sending', attempts = e.attempts + 1, next_attempt_at = now()
    from due where e.id = due.id
    returning e.id, e.to_email, e.cc, e.subject, e.body_html, e.attachments, e.attempts`;

  for (const email of claimed) {
    try {
      if (isDryRun()) {
        log.info({ to: email.toEmail, subject: email.subject }, '[dry-run] email not sent');
      } else {
        await getTransport().sendMail({
          from: optional('EMAIL_FROM', optional('SMTP_USER')),
          to: email.toEmail,
          cc: email.cc?.length ? email.cc : undefined,
          subject: email.subject,
          html: email.bodyHtml,
          text: htmlToText(email.bodyHtml),
          attachments: (email.attachments ?? []).map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
        });
      }
      await sql`update notify.emails set status = 'sent', sent_at = now(), last_error = null where id = ${email.id}`;
    } catch (err) {
      const message = (err as Error).message?.slice(0, 1000) ?? 'Unknown error';
      const failed = email.attempts >= MAX_ATTEMPTS;
      await sql`
        update notify.emails set
          status = ${failed ? 'failed' : 'queued'},
          last_error = ${message},
          next_attempt_at = now() + (interval '1 minute' * ${2 ** email.attempts}::float8)
        where id = ${email.id}`;
      log.warn({ id: email.id, to: email.toEmail, attempts: email.attempts, failed, err: message }, 'Email delivery failed');
    }
  }
  return claimed.length;
}
