import { startService } from '@hireflow/shared';
import { sql } from './db.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { departmentRoutes } from './routes/departments.js';

await startService({
  name: 'identity',
  healthCheck: () => sql`select 1`,
  routes: async (app) => {
    await authRoutes(app);
    await userRoutes(app);
    await departmentRoutes(app);
  },
  onClose: () => sql.end(),
});
