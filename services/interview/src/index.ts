import { every, startService } from '@hireflow/shared';
import { sql } from './db.js';
import { runMaintenance } from './lib/rounds.js';
import { publicRoutes } from './routes/public.js';
import { roundRoutes } from './routes/rounds.js';

await startService({
  name: 'interview',
  routes: async (app) => {
    await roundRoutes(app);
    await publicRoutes(app);
  },
  healthCheck: () => sql`select 1`,
  workers: [(signal, app) => every(60_000, () => runMaintenance(app.log), app.log, 'Interview maintenance')(signal)],
  onClose: async () => {
    await sql.end({ timeout: 5 });
  },
});
