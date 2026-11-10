import { startService } from '@hireflow/shared';
import { sql } from './db.js';
import { caseRoutes } from './routes/cases.js';
import { publicRoutes } from './routes/public.js';
import { settingsRoutes } from './routes/settings.js';

await startService({
  name: 'onboarding',
  multipartMaxMb: 10,
  routes: async (app) => {
    await caseRoutes(app);
    await settingsRoutes(app);
    await publicRoutes(app);
  },
  healthCheck: () => sql`select 1`,
  onClose: async () => {
    await sql.end({ timeout: 5 });
  },
});
