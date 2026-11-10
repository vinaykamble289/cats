import type { FastifyInstance } from 'fastify';
import {
  badRequest,
  defined,
  email,
  env,
  getUser,
  idParams,
  notFound,
  optionalText,
  orNotFound,
  paginationQuery,
  parse,
  requireRole,
  ROLES,
  supabaseAdmin,
  toLimitOffset,
  z,
  csvList,
} from '@hireflow/shared';
import { sql } from '../db.js';

export interface UserRow {
  id: string;
  email: string;
  fullName: string;
  title: string | null;
  role: (typeof ROLES)[number];
  departmentId: string | null;
  departmentName: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  hasLoggedIn: boolean;
}

const userSelect = sql`
  select u.id, u.email, u.full_name, u.title, u.role, u.department_id, d.name as department_name,
         u.is_active, u.last_login_at, u.created_at, (u.auth_user_id is not null) as has_logged_in
  from identity.users u
  left join identity.departments d on d.id = u.department_id
`;

export async function getUserById(id: string): Promise<UserRow | undefined> {
  const [row] = await sql<UserRow[]>`${userSelect} where u.id = ${id}`;
  return row;
}

async function sendInvite(userEmail: string, fullName: string): Promise<{ ok: boolean; error?: string; alreadyRegistered?: boolean }> {
  try {
    const { error } = await supabaseAdmin().auth.admin.inviteUserByEmail(userEmail, {
      redirectTo: `${env.appUrl}/login`,
      data: { full_name: fullName },
    });
    if (error) {
      if (/already|registered|exists/i.test(error.message)) return { ok: false, alreadyRegistered: true, error: error.message };
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

const roleEnum = z.enum(ROLES);
const password = z.string().min(8, 'Password must be at least 8 characters').max(72);

/** Finds the Supabase auth account for an email (admin API has no direct lookup). */
async function findAuthUserId(userEmail: string): Promise<string | null> {
  const target = userEmail.toLowerCase();
  for (let page = 1; page < 100; page++) {
    const { data, error } = await supabaseAdmin().auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw badRequest(`Could not look up auth account: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < 1000) return null;
  }
  return null;
}

/** Creates (or updates) the Supabase auth account so the user can sign in with this password. */
async function setAuthPassword(userEmail: string, fullName: string, newPassword: string): Promise<void> {
  const authId = await findAuthUserId(userEmail);
  const { error } = authId
    ? await supabaseAdmin().auth.admin.updateUserById(authId, { password: newPassword, email_confirm: true })
    : await supabaseAdmin().auth.admin.createUser({ email: userEmail, password: newPassword, email_confirm: true, user_metadata: { full_name: fullName } });
  if (error) throw badRequest(`Could not set password: ${error.message}`);
}

/** Refuses changes that would leave the workspace without an active admin. */
async function assertNotLastAdmin(id: string): Promise<void> {
  const [{ others }] = await sql<{ others: number }[]>`
    select count(*)::int as others from identity.users where role = 'admin' and is_active and id <> ${id}`;
  if (others === 0) throw badRequest('This is the last active admin. Promote someone else to admin first.');
}

export async function userRoutes(app: FastifyInstance) {
  // ---------- internal ----------
  app.get('/internal/users', async (req) => {
    const q = parse(z.object({ ids: csvList }), req.query);
    const ids = (q.ids ?? []).filter((id) => z.string().uuid().safeParse(id).success);
    if (!ids.length) return [];
    const rows = await sql<{ id: string; email: string; fullName: string; role: string; isActive: boolean }[]>`
      select id, email, full_name, role, is_active from identity.users where id = any(${sql.array(ids)}::uuid[])`;
    return rows.map((r) => ({ id: r.id, email: r.email, name: r.fullName || r.email, role: r.role, isActive: r.isActive }));
  });

  app.get('/internal/users/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const [r] = await sql<{ id: string; email: string; fullName: string; role: string; isActive: boolean }[]>`
      select id, email, full_name, role, is_active from identity.users where id = ${id}`;
    if (!r) throw notFound('User');
    return { id: r.id, email: r.email, name: r.fullName || r.email, role: r.role, isActive: r.isActive };
  });

  // ---------- me ----------
  app.get('/me', async (req) => {
    const user = getUser(req);
    return orNotFound(await getUserById(user.id), 'User');
  });

  app.patch('/me', async (req) => {
    const user = getUser(req);
    const body = parse(z.object({ fullName: z.string().trim().min(1).max(120).optional(), title: optionalText(120) }), req.body);
    const patch = defined(body);
    if (Object.keys(patch).length) await sql`update identity.users set ${sql(patch)} where id = ${user.id}`;
    return orNotFound(await getUserById(user.id), 'User');
  });

  // ---------- team directory ----------
  app.get('/users', async (req) => {
    getUser(req);
    const q = parse(
      paginationQuery.extend({
        role: csvList,
        q: z.string().trim().max(100).optional(),
        active: z.enum(['true', 'false']).optional(),
        departmentId: z.string().uuid().optional(),
      }),
      req.query,
    );
    const { limit, offset } = toLimitOffset(q);
    const roles = (q.role ?? []).filter((r) => (ROLES as readonly string[]).includes(r));
    const term = q.q ? `%${q.q}%` : null;
    const where = sql`
      where true
      ${roles.length ? sql`and u.role::text = any(${sql.array(roles)}::text[])` : sql``}
      ${term ? sql`and (u.full_name ilike ${term} or u.email ilike ${term})` : sql``}
      ${q.active ? sql`and u.is_active = ${q.active === 'true'}` : sql``}
      ${q.departmentId ? sql`and u.department_id = ${q.departmentId}` : sql``}
    `;
    const [rows, [{ total }]] = await Promise.all([
      sql<UserRow[]>`${userSelect} ${where} order by u.is_active desc, lower(nullif(u.full_name, '')) nulls last, u.email limit ${limit} offset ${offset}`,
      sql<{ total: number }[]>`select count(*)::int as total from identity.users u ${where}`,
    ]);
    return { data: rows, total };
  });

  app.post('/users', async (req, reply) => {
    const actor = requireRole(req);
    const body = parse(
      z.object({
        email,
        fullName: z.string().trim().max(120).default(''),
        role: roleEnum.default('recruiter'),
        departmentId: z.string().uuid().nullish(),
        title: optionalText(120),
        sendInvite: z.boolean().default(true),
        password: password.optional(),
      }),
      req.body,
    );
    const [existing] = await sql`select 1 from identity.users where email = ${body.email}`;
    if (existing) throw badRequest('A user with this email already exists');
    const [created] = await sql<{ id: string }[]>`
      insert into identity.users (email, full_name, role, department_id, title)
      values (${body.email}, ${body.fullName}, ${body.role}, ${body.departmentId ?? null}, ${body.title ?? null})
      returning id`;
    let inviteError: string | undefined;
    if (body.password) {
      try {
        await setAuthPassword(body.email, body.fullName, body.password);
      } catch (err) {
        await sql`delete from identity.users where id = ${created.id}`;
        throw err;
      }
    } else if (body.sendInvite) {
      const res = await sendInvite(body.email, body.fullName);
      if (!res.ok && !res.alreadyRegistered) {
        inviteError = res.error;
        req.log.warn({ err: res.error, email: body.email, actor: actor.id }, 'Supabase invite failed');
      }
    }
    const user = await getUserById(created.id);
    return reply.status(201).send({ ...user, inviteError });
  });

  app.patch('/users/:id', async (req) => {
    const actor = requireRole(req);
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({
        fullName: z.string().trim().max(120).optional(),
        role: roleEnum.optional(),
        departmentId: z.string().uuid().nullish(),
        title: optionalText(120),
        isActive: z.boolean().optional(),
      }),
      req.body,
    );
    if (id === actor.id && ((body.role && body.role !== 'admin') || body.isActive === false)) {
      throw badRequest('You cannot change your own admin role or deactivate yourself');
    }
    const target = orNotFound(await getUserById(id), 'User');
    if (target.role === 'admin' && target.isActive && ((body.role && body.role !== 'admin') || body.isActive === false)) {
      await assertNotLastAdmin(id);
    }
    const patch = defined(body);
    if (Object.keys(patch).length) {
      const res = await sql`update identity.users set ${sql(patch)} where id = ${id}`;
      if (!res.count) throw notFound('User');
    }
    return orNotFound(await getUserById(id), 'User');
  });

  app.post('/users/:id/resend-invite', async (req) => {
    requireRole(req);
    const { id } = parse(idParams, req.params);
    const user = orNotFound(await getUserById(id), 'User');
    if (user.hasLoggedIn) throw badRequest('This user has already signed in');
    const res = await sendInvite(user.email, user.fullName);
    if (res.alreadyRegistered) throw badRequest('This email is already registered. Ask the user to sign in, or reset their password.');
    if (!res.ok) throw badRequest(`Invite could not be sent: ${res.error}`);
    return { ok: true };
  });

  /** Admin sets a user's password directly (creates their sign-in account if needed). */
  app.post('/users/:id/password', async (req) => {
    const actor = requireRole(req);
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ password }), req.body);
    const user = orNotFound(await getUserById(id), 'User');
    await setAuthPassword(user.email, user.fullName, body.password);
    req.log.info({ userId: id, actor: actor.id }, 'Admin set user password');
    return { ok: true };
  });

  /** Emails the user a password-reset link. */
  app.post('/users/:id/reset-password', async (req) => {
    requireRole(req);
    const { id } = parse(idParams, req.params);
    const user = orNotFound(await getUserById(id), 'User');
    if (!user.isActive) throw badRequest('Reactivate this user before sending a reset link');
    const { error } = await supabaseAdmin().auth.resetPasswordForEmail(user.email, { redirectTo: `${env.appUrl}/login` });
    if (error) throw badRequest(`Reset email could not be sent: ${error.message}`);
    return { ok: true };
  });

  /**
   * Permanently removes a user who has never signed in (e.g. a mistaken invite).
   * Users with history are deactivated instead so their past activity stays attributable.
   */
  app.delete('/users/:id', async (req, reply) => {
    const actor = requireRole(req);
    const { id } = parse(idParams, req.params);
    if (id === actor.id) throw badRequest('You cannot delete yourself');
    const user = orNotFound(await getUserById(id), 'User');
    if (user.hasLoggedIn) throw badRequest('This user has already signed in. Deactivate them instead to keep their history.');
    if (user.role === 'admin' && user.isActive) await assertNotLastAdmin(id);
    await sql`delete from identity.users where id = ${id}`;
    try {
      const authId = await findAuthUserId(user.email);
      if (authId) await supabaseAdmin().auth.admin.deleteUser(authId);
    } catch (err) {
      req.log.warn({ err, email: user.email }, 'Could not remove Supabase auth account');
    }
    req.log.info({ userId: id, actor: actor.id }, 'Deleted user');
    return reply.status(204).send();
  });
}
