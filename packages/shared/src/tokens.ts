import { createHash, randomBytes } from 'node:crypto';
import { env } from './env.js';

/** Creates an unguessable token for candidate links. Only the hash is stored. */
export function createToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Builds a candidate-portal URL, e.g. portalUrl('assessment', token) -> https://app/portal/assessment/<token> */
export function portalUrl(kind: 'assessment' | 'interview' | 'offer' | 'onboarding', token: string): string {
  return `${env.appUrl}/portal/${kind}/${token}`;
}

export function appUrl(path: string): string {
  return `${env.appUrl}${path.startsWith('/') ? '' : '/'}${path}`;
}

export function addDays(days: number, from = new Date()): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Human friendly date for emails, e.g. "Mon, 10 Nov 2026, 10:30 AM IST" */
export function formatDateTime(d: Date | string, timeZone = process.env.TZ_DISPLAY || 'Asia/Kolkata'): string {
  return new Intl.DateTimeFormat('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(new Date(d));
}

export function formatDate(d: Date | string): string {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(d));
}
