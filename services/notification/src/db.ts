import { createDb } from '@hireflow/shared';

/** Owns schema `notify`; also reads the shared `platform.events` log for the activity feed. */
export const sql = createDb('notify');
