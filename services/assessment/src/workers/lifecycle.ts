import type { FastifyInstance } from 'fastify';
import { every } from '@hireflow/shared';
import { sql } from '../db.js';
import { gradeInvitation } from '../lib/grading.js';

/**
 * Every minute:
 * - expires unopened invitations past their link expiry
 * - auto-submits tests whose time ran out (deadline + 2 min) and grades them
 * - retries grading for submissions stuck in 'submitted' (e.g. service restarted mid-grading)
 */
export function lifecycleWorker(signal: AbortSignal, app: FastifyInstance): void {
  every(
    60_000,
    async () => {
      await sql`update assessment.invitations set status = 'expired' where status = 'invited' and expires_at < now()`;
      const timedOut = await sql<{ id: string }[]>`
        update assessment.invitations set status = 'submitted', submitted_at = deadline_at
        where status = 'started' and deadline_at + interval '2 minutes' < now()
        returning id
      `;
      const stuck = await sql<{ id: string }[]>`
        select id from assessment.invitations
        where status = 'submitted' and submitted_at < now() - interval '5 minutes'
        limit 20
      `;
      for (const { id } of [...timedOut, ...stuck]) {
        if (signal.aborted) return;
        await gradeInvitation(id, app.log).catch((err) => app.log.error({ err, invitationId: id }, 'Grading failed'));
      }
    },
    app.log,
    'Assessment lifecycle',
  )(signal);
}
