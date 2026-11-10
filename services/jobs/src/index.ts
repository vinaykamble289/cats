import { startService } from '@hireflow/shared';
import { sql } from './db.js';
import { jobRoutes } from './routes/jobs.js';
import { publicRoutes } from './routes/public.js';
import { internalRoutes } from './routes/internal.js';

await startService({
  name: 'jobs',
  healthCheck: () => sql`select 1`,
  routes: async (app) => {
    await jobRoutes(app);
    await publicRoutes(app);
    await internalRoutes(app);
  },
  onClose: () => sql.end(),
});
