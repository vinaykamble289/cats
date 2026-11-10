import { startService } from '@hireflow/shared';
import { sql } from './db.js';
import { invitationRoutes } from './routes/invitations.js';
import { publicRoutes } from './routes/public.js';
import { testRoutes } from './routes/tests.js';
import { lifecycleWorker } from './workers/lifecycle.js';

await startService({
  name: 'assessment',
  healthCheck: () => sql`select 1`,
  routes: async (app) => {
    await testRoutes(app);
    await invitationRoutes(app);
    await publicRoutes(app);
  },
  workers: [lifecycleWorker],
  onClose: () => sql.end({ timeout: 5 }),
});
