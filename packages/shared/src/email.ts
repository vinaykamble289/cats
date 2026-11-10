import { callService } from './client.js';
import type { FastifyBaseLogger } from 'fastify';

export interface QueueEmailInput {
  templateKey: string;
  to: string;
  cc?: string[];
  /** Variables for the template, e.g. { candidateName, jobTitle, link } */
  data: Record<string, unknown>;
  relatedType?: string;
  relatedId?: string;
  candidateId?: string;
  /** Plain-text attachments (e.g. an .ics calendar invite) */
  attachments?: { filename: string; content: string; contentType: string }[];
  createdBy?: string;
}

/** Queues a templated email in notification-service (delivered asynchronously with retries). */
export async function queueEmail(input: QueueEmailInput): Promise<{ id: string }> {
  return callService<{ id: string }>('notification', '/internal/emails', { method: 'POST', body: input });
}

/** Same as queueEmail but never throws - failures are logged. Use after the main action committed. */
export async function queueEmailSafe(input: QueueEmailInput, log?: FastifyBaseLogger): Promise<boolean> {
  try {
    await queueEmail(input);
    return true;
  } catch (err) {
    log?.error({ err, templateKey: input.templateKey, to: input.to }, 'Failed to queue email');
    return false;
  }
}
