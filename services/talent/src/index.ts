import { startService } from '@hireflow/shared';
import { sql } from './db.js';
import { applicationRoutes } from './routes/applications.js';
import { candidateRoutes } from './routes/candidates.js';
import { internalRoutes } from './routes/internal.js';
import { publicRoutes } from './routes/public.js';
import { reviewRoutes } from './routes/reviews.js';
import { imapWorker } from './workers/imap.js';

await startService({
  name: 'talent',
  multipartMaxMb: 10,
  healthCheck: () => sql`select 1`,
  routes: async (app) => {
    await candidateRoutes(app);
    await applicationRoutes(app);
    await reviewRoutes(app);
    await publicRoutes(app);
    await internalRoutes(app);
  },
  workers: [imapWorker],
  onClose: () => sql.end({ timeout: 5 }),
});
