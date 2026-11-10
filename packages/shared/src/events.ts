import type { Db } from './db.js';

export interface DomainEvent {
  /** e.g. 'application.stage_changed', 'offer.accepted' */
  type: string;
  aggregateType: string;
  aggregateId: string;
  candidateId?: string | null;
  jobId?: string | null;
  applicationId?: string | null;
  actorId?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Appends a domain event to the shared, append-only event log.
 * Call with the transaction handle so the event commits atomically with the change.
 * Powers the audit trail and the activity timelines in the UI.
 */
export async function publishEvent(db: Db, e: DomainEvent): Promise<void> {
  await db`
    insert into platform.events (type, aggregate_type, aggregate_id, candidate_id, job_id, application_id, actor_id, payload)
    values (${e.type}, ${e.aggregateType}, ${e.aggregateId}, ${e.candidateId ?? null}, ${e.jobId ?? null},
            ${e.applicationId ?? null}, ${e.actorId ?? null}, ${db.json((e.payload ?? {}) as never)})
  `;
}
