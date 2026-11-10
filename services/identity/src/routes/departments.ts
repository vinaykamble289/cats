import type { FastifyInstance } from 'fastify';
import { getUser, idParams, notFound, parse, requireRole, z } from '@hireflow/shared';
import { sql } from '../db.js';

const nameBody = z.object({ name: z.string().trim().min(1).max(100) });

export async function departmentRoutes(app: FastifyInstance) {
  app.get('/departments', async (req) => {
    getUser(req);
    const rows = await sql<{ id: string; name: string; userCount: number }[]>`
      select d.id, d.name, count(u.id)::int as user_count
      from identity.departments d
      left join identity.users u on u.department_id = d.id and u.is_active
      group by d.id
      order by lower(d.name)`;
    return { data: rows, total: rows.length };
  });

  app.post('/departments', async (req, reply) => {
    requireRole(req, 'recruiter');
    const { name } = parse(nameBody, req.body);
    const [row] = await sql<{ id: string; name: string }[]>`insert into identity.departments (name) values (${name}) returning id, name`;
    return reply.status(201).send({ ...row, userCount: 0 });
  });

  app.patch('/departments/:id', async (req) => {
    requireRole(req, 'recruiter');
    const { id } = parse(idParams, req.params);
    const { name } = parse(nameBody, req.body);
    const [row] = await sql<{ id: string; name: string }[]>`update identity.departments set name = ${name} where id = ${id} returning id, name`;
    if (!row) throw notFound('Department');
    const [{ userCount }] = await sql<{ userCount: number }[]>`select count(*)::int as user_count from identity.users where department_id = ${id} and is_active`;
    return { ...row, userCount };
  });

  app.delete('/departments/:id', async (req, reply) => {
    requireRole(req);
    const { id } = parse(idParams, req.params);
    const res = await sql`delete from identity.departments where id = ${id}`;
    if (!res.count) throw notFound('Department');
    return reply.status(204).send();
  });
}
