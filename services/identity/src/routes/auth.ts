import type { FastifyInstance } from 'fastify';
import { email, forbidden, optional, parse, z } from '@hireflow/shared';
import { sql } from '../db.js';

interface ResolveRow {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  authUserId: string | null;
  lastLoginAt: Date | null;
}

const LOGIN_TOUCH_MS = 5 * 60_000;

function adminEmails(): string[] {
  return optional('ADMIN_EMAILS')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function toAuthUser(u: ResolveRow) {
  return { id: u.id, email: u.email, role: u.role, name: u.fullName || u.email, isActive: u.isActive };
}

export async function authRoutes(app: FastifyInstance) {
  /**
   * Maps a Supabase auth user to a HireFlow user.
   * Order: linked auth id -> invited email -> bootstrap (first user / ADMIN_EMAILS) -> 403.
   */
  app.post('/internal/auth/resolve', async (req) => {
    const body = parse(
      z.object({ authUserId: z.string().uuid(), email, name: z.string().trim().max(120).optional().default('') }),
      req.body,
    );

    const [linked] = await sql<ResolveRow[]>`
      select id, email, full_name, role, is_active, auth_user_id, last_login_at
      from identity.users where auth_user_id = ${body.authUserId}`;
    if (linked) {
      if (!linked.lastLoginAt || Date.now() - new Date(linked.lastLoginAt).getTime() > LOGIN_TOUCH_MS) {
        await sql`update identity.users set last_login_at = now() where id = ${linked.id}`;
      }
      return toAuthUser(linked);
    }

    // Invited by email (or auth account re-created) -> link it
    const [invited] = await sql<ResolveRow[]>`
      update identity.users
      set auth_user_id = ${body.authUserId},
          full_name = case when full_name = '' then ${body.name} else full_name end,
          last_login_at = now()
      where email = ${body.email}
      returning id, email, full_name, role, is_active, auth_user_id, last_login_at`;
    if (invited) return toAuthUser(invited);

    // Bootstrap: first user ever, or configured admin emails, become admins.
    const created = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('identity.bootstrap'))`;
      const [{ count }] = await tx<{ count: number }[]>`select count(*)::int as count from identity.users`;
      if (count > 0 && !adminEmails().includes(body.email)) return null;
      const [row] = await tx<ResolveRow[]>`
        insert into identity.users (auth_user_id, email, full_name, role, last_login_at)
        values (${body.authUserId}, ${body.email}, ${body.name}, 'admin', now())
        on conflict (email) do update set auth_user_id = excluded.auth_user_id
        returning id, email, full_name, role, is_active, auth_user_id, last_login_at`;
      return row;
    });
    if (!created) throw forbidden('You have not been invited to HireFlow. Ask your administrator to invite you.');
    req.log.info({ email: body.email }, 'Bootstrapped admin user');
    return toAuthUser(created);
  });
}
