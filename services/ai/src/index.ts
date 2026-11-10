import { startService } from '@hireflow/shared';
import { aiRoutes } from './routes/ai.js';
import { isConfigured } from './groq.js';

const app = await startService({
  name: 'ai',
  routes: aiRoutes,
});

if (!isConfigured()) app.log.warn('GROQ_API_KEY is not set - AI features will return 503 AI_NOT_CONFIGURED');
