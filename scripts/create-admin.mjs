// Creates (or promotes) a HireFlow admin who can sign in with email + password.
//
// Usage:
//   npm run admin:create -- --email admin@company.com [--password "S3cret!pass"] [--name "Jane Admin"]
//
// - If the Supabase auth account does not exist it is created (email pre-confirmed).
// - If it exists and --password is given, the password is reset to that value.
// - If no --password is given for a new account, a random one is generated and printed.
// - The identity.users row is created or updated to role=admin, active.
// Safe to re-run. Requires DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import 'dotenv/config';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

const { values: args } = parseArgs({
  options: {
    email: { type: 'string', short: 'e' },
    password: { type: 'string', short: 'p' },
    name: { type: 'string', short: 'n', default: '' },
    help: { type: 'boolean', short: 'h' },
  },
});

const usage = 'Usage: npm run admin:create -- --email <email> [--password <password>] [--name "<full name>"]';
if (args.help) {
  console.log(usage);
  process.exit(0);
}

const email = (args.email ?? '').trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error(`A valid --email is required.\n${usage}`);
  process.exit(1);
}
if (args.password !== undefined && (args.password.length < 8 || args.password.length > 72)) {
  console.error('--password must be 8-72 characters.');
  process.exit(1);
}
const name = args.name.trim().slice(0, 120);

for (const key of ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!process.env[key]) {
    console.error(`${key} is not set (see .env.example)`);
    process.exit(1);
  }
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });

async function findAuthUser(target) {
  for (let page = 1; page < 100; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not list Supabase users: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < 1000) return null;
  }
  return null;
}

try {
  let generated = null;
  const existing = await findAuthUser(email);

  if (existing) {
    const update = { email_confirm: true };
    if (args.password) update.password = args.password;
    const { error } = await supabase.auth.admin.updateUserById(existing.id, update);
    if (error) throw new Error(`Could not update Supabase user: ${error.message}`);
    console.log(`Supabase auth account exists${args.password ? ' - password updated' : ' - password unchanged'}.`);
  } else {
    const password = args.password ?? (generated = randomBytes(12).toString('base64url'));
    const { error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name },
    });
    if (error) throw new Error(`Could not create Supabase user: ${error.message}`);
    console.log('Created Supabase auth account.');
  }

  // auth_user_id is linked automatically (by email) on the first sign-in.
  const [row] = await sql`
    insert into identity.users (email, full_name, role, is_active)
    values (${email}, ${name}, 'admin', true)
    on conflict (email) do update
      set role = 'admin',
          is_active = true,
          full_name = case when ${name} <> '' then ${name} else identity.users.full_name end
    returning id, (xmax = 0) as inserted`;
  console.log(`${row.inserted ? 'Created' : 'Promoted existing'} HireFlow admin ${email} (id ${row.id}).`);

  if (generated) {
    console.log(`\nGenerated password: ${generated}\nSign in and change it, or re-run with --password to set your own.`);
  }
} catch (err) {
  console.error(`\nFailed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
