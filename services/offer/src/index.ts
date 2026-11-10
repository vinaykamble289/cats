import { every, publishEvent, startService } from '@hireflow/shared';
import { sql } from './db.js';
import { eventBase } from './lib/offers.js';
import { offerRoutes } from './routes/offers.js';
import { publicRoutes } from './routes/public.js';

/** Expires offers whose validity has passed. */
async function expireOffers() {
  await sql.begin(async (tx) => {
    const expired = await tx`
      update offer.offers set status = 'expired'
      where status in ('sent', 'negotiating') and expires_at < now() returning *
    `;
    for (const o of expired) {
      await publishEvent(tx, { type: 'offer.expired', ...eventBase(o), payload: { candidateName: o.candidateName, jobTitle: o.jobTitle } });
    }
  });
}

await startService({
  name: 'offer',
  routes: async (app) => {
    await offerRoutes(app);
    await publicRoutes(app);
  },
  healthCheck: () => sql`select 1`,
  workers: [(signal, app) => every(5 * 60_000, expireOffers, app.log, 'Offer expiry')(signal)],
  onClose: async () => {
    await sql.end({ timeout: 5 });
  },
});
