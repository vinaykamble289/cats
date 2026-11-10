import { every, startService } from '@hireflow/shared';
import { sql } from './db.js';
import { processOutbox, verifySmtp } from './mailer.js';
import { emailRoutes } from './routes/emails.js';
import { templateRoutes } from './routes/templates.js';
import { activityRoutes } from './routes/activity.js';

await startService({
  name: 'notification',
  healthCheck: () => sql`select 1`,
  routes: async (app) => {
    await emailRoutes(app);
    await templateRoutes(app);
    await activityRoutes(app);
  },
  workers: [
    (signal, app) => {
      void verifySmtp(app.log);
      // Outbox delivery loop; drains quickly when there is a backlog.
      every(5_000, async () => {
        for (let i = 0; i < 10 && !signal.aborted; i++) {
          if ((await processOutbox(app.log)) === 0) break;
        }
      }, app.log, 'Email outbox')(signal);
    },
  ],
  onClose: () => sql.end(),
});
